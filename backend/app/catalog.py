"""HR course and test editor: drafts, optional AI suggestions, four-eyes review, publication.

A draft never reaches recommendations. Only an explicitly published, reviewed version is
added to the catalog; a new version gets a new event ID and the previous one is retired,
so completed history keeps the gains it was recorded with. The model only suggests text
and questions for a draft and cannot publish or assign skill gains.
"""

from datetime import date
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, select

from app import ai
from app.config import settings
from app.db import get_session
from app.models import Audit, Document, now
from app.security import current_account, hr_account
from app.seed import bundle

router = APIRouter(prefix="/api", tags=["Course catalog"])
GRADES = ["Junior", "Middle", "Senior", "Lead"]
MAX_ATTEMPTS = 3


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Gain(Strict):
    skill_id: str
    gain: int = Field(ge=1, le=2, strict=True)
    max_level: int = Field(ge=1, le=5, strict=True)


class Question(Strict):
    question: str = Field(min_length=5, max_length=300)
    options: list[str] = Field(min_length=2, max_length=5)
    correct: int = Field(ge=0, strict=True)
    skill_id: str | None = None


class Quiz(Strict):
    questions: list[Question] = Field(min_length=1, max_length=20)
    pass_score: int = Field(ge=50, le=100, strict=True)


class CourseDraft(Strict):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=1500)
    type: Literal["course", "workshop", "mentoring", "certification", "meetup"]
    format: Literal["online", "offline", "self_paced"]
    duration_hours: int = Field(ge=1, le=200, strict=True)
    target_roles: list[str] = Field(min_length=1, max_length=8)
    target_grades: list[Literal["Junior", "Middle", "Senior", "Lead"]] = Field(min_length=1)
    develops_skills: list[Gain] = Field(min_length=1, max_length=5)
    prerequisites: dict[str, int] = Field(default_factory=dict)
    upcoming_sessions: list[date] = Field(default_factory=list, max_length=12)
    quiz: Quiz | None = None
    revision: int = Field(default=0, ge=0)


class Decision(Strict):
    decision: Literal["approved", "changes_requested"]
    note: str = Field(min_length=3, max_length=1000)


class Attempt(Strict):
    answers: list[int] = Field(min_length=1, max_length=20)


def validate_draft(body, session):
    skills, _, _ = bundle(session)
    known = {s["skill_id"] for s in skills["skills"]}
    roles = {p["role"] for p in skills["role_profiles"]}
    as_of = skills["meta"]["as_of_date"]
    errors = []
    if set(body.target_roles) - roles:
        errors.append("неизвестная роль")
    used = [g.skill_id for g in body.develops_skills]
    if set(used) - known or len(set(used)) != len(used):
        errors.append("неизвестные или повторяющиеся навыки")
    if set(body.prerequisites) - known or any(not 1 <= v <= 5 for v in body.prerequisites.values()):
        errors.append("предпосылки должны ссылаться на навыки с уровнем 1–5")
    sessions = sorted({d.isoformat() for d in body.upcoming_sessions})
    if body.format == "self_paced" and sessions:
        errors.append("у курса в своём темпе нет сессий")
    if body.format != "self_paced" and (not sessions or sessions[0] < as_of):
        errors.append("нужна хотя бы одна будущая сессия")
    for q in body.quiz.questions if body.quiz else []:
        if q.correct >= len(q.options) or (q.skill_id and q.skill_id not in known):
            errors.append("в тесте неверный номер правильного ответа или навык")
            break
    if errors:
        raise HTTPException(422, "Проверьте курс: " + "; ".join(errors))
    data = body.model_dump(mode="json", exclude={"revision"})
    data["upcoming_sessions"] = sessions
    data["target_grades"] = [g for g in GRADES if g in body.target_grades]
    return data


def course_doc(session, cid, lock=False):
    query = select(Document).where(Document.id == f"course:{cid}", Document.kind == "course")
    doc = session.exec(query.with_for_update() if lock else query).first()
    if not doc:
        raise HTTPException(404, "Курс не найден")
    return doc


def log(course, actor, action, note=""):
    return [*course["history"], {"action": action, "actor": actor, "at": now(), "note": note}]


def save(session, doc, payload, actor, action):
    doc.payload = payload
    session.add(doc)
    session.add(Audit(actor=actor, action=f"course_{action}", target=doc.id))
    session.commit()
    return payload


@router.get("/hr/courses")
def list_courses(account=Depends(hr_account), session: Session = Depends(get_session)):
    docs = session.exec(select(Document).where(Document.kind == "course")).all()
    return sorted((d.payload for d in docs), key=lambda c: c["updated_at"], reverse=True)


@router.post("/hr/courses", status_code=201)
def create_course(
    body: CourseDraft, account=Depends(hr_account), session: Session = Depends(get_session)
):
    cid = uuid4().hex[:10]
    course = {
        "course_id": cid,
        "status": "draft",
        "version": 1,
        "revision": 1,
        "draft": validate_draft(body, session),
        "author": account.username,
        "reviewer": None,
        "ai_assisted": False,
        "event_id": None,
        "previous_event_ids": [],
        "created_at": now(),
        "updated_at": now(),
        "history": [],
    }
    course["history"] = log(course, account.username, "created")
    session.add(Document(id=f"course:{cid}", kind="course", payload=course))
    session.add(Audit(actor=account.username, action="course_created", target=f"course:{cid}"))
    session.commit()
    return course


@router.put("/hr/courses/{cid}")
def update_course(
    cid: str,
    body: CourseDraft,
    ai_assisted: bool = False,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    doc = course_doc(session, cid, lock=True)
    course = doc.payload
    if course["status"] not in {"draft", "changes_requested"}:
        raise HTTPException(409, "Редактировать можно только черновик. Создайте новую версию.")
    if body.revision != course["revision"]:
        raise HTTPException(409, "Курс уже изменён. Обновите страницу и повторите.")
    payload = {
        **course,
        "draft": validate_draft(body, session),
        "status": "draft",
        "revision": course["revision"] + 1,
        "ai_assisted": course["ai_assisted"] or ai_assisted,
        "updated_at": now(),
        "history": log(course, account.username, "edited"),
    }
    return save(session, doc, payload, account.username, "edited")


def transition(cid, account, session, allowed, status, action, note="", **extra):
    doc = course_doc(session, cid, lock=True)
    course = doc.payload
    if course["status"] not in allowed:
        raise HTTPException(409, "Это действие недоступно в текущем статусе курса")
    payload = {
        **course,
        **extra,
        "status": status,
        "updated_at": now(),
        "history": log(course, account.username, action, note),
    }
    return save(session, doc, payload, account.username, action)


@router.post("/hr/courses/{cid}/submit")
def submit_course(cid: str, account=Depends(hr_account), session: Session = Depends(get_session)):
    return transition(cid, account, session, {"draft"}, "in_review", "submitted")


@router.post("/hr/courses/{cid}/review")
def review_course(
    cid: str, body: Decision, account=Depends(hr_account), session: Session = Depends(get_session)
):
    course = course_doc(session, cid).payload
    if course["author"] == account.username:
        raise HTTPException(403, "Курс проверяет другой HR-эксперт, не автор черновика")
    return transition(
        cid,
        account,
        session,
        {"in_review"},
        body.decision,
        body.decision,
        body.note,
        reviewer=account.username,
    )


@router.post("/hr/courses/{cid}/publish")
def publish_course(cid: str, account=Depends(hr_account), session: Session = Depends(get_session)):
    doc = course_doc(session, cid, lock=True)
    course = doc.payload
    if course["status"] != "approved":
        raise HTTPException(409, "Опубликовать можно только курс, одобренный экспертом")
    catalog = session.exec(
        select(Document).where(Document.id == "catalog:events").with_for_update()
    ).one()
    events = catalog.payload["events"]
    taken = {e["event_id"] for e in events}
    number = 1 + sum(e["event_id"].startswith("CQ_EV_") for e in events)
    while f"CQ_EV_{number:03d}" in taken:
        number += 1
    event_id = f"CQ_EV_{number:03d}"
    previous = [
        *course["previous_event_ids"],
        *([course["event_id"]] if course["event_id"] else []),
    ]
    event = {
        **{k: v for k, v in course["draft"].items() if k != "quiz"},
        "event_id": event_id,
        "mandatory": False,
        "custom": True,
        "course_id": cid,
        "version": course["version"],
        "has_quiz": bool(course["draft"].get("quiz")),
    }
    # Retire earlier versions: history stays valid, but they are no longer recommended.
    events = [{**e, "retired": True} if e["event_id"] in previous else e for e in events]
    catalog.payload = {**catalog.payload, "events": [*events, event]}
    session.add(catalog)
    payload = {
        **course,
        "status": "published",
        "event_id": event_id,
        "previous_event_ids": previous,
        # Snapshot per published version: later drafts never change a live test.
        "published_quizzes": [
            *course.get("published_quizzes", []),
            {"event_id": event_id, "quiz": course["draft"].get("quiz")},
        ],
        "published_at": now(),
        "updated_at": now(),
        "history": log(course, account.username, "published", event_id),
    }
    return save(session, doc, payload, account.username, "published")


@router.post("/hr/courses/{cid}/new-version")
def new_version(cid: str, account=Depends(hr_account), session: Session = Depends(get_session)):
    course = course_doc(session, cid).payload
    return transition(
        cid,
        account,
        session,
        {"published", "archived"},
        "draft",
        "new_version",
        reviewer=None,
        author=account.username,
        version=course["version"] + 1,
        revision=course["revision"] + 1,
    )


@router.post("/hr/courses/{cid}/archive")
def archive_course(cid: str, account=Depends(hr_account), session: Session = Depends(get_session)):
    course = course_doc(session, cid).payload
    catalog = session.exec(
        select(Document).where(Document.id == "catalog:events").with_for_update()
    ).one()
    catalog.payload = {
        **catalog.payload,
        "events": [
            {**e, "retired": True} if e["event_id"] == course["event_id"] else e
            for e in catalog.payload["events"]
        ],
    }
    session.add(catalog)
    return transition(cid, account, session, {"published"}, "archived", "archived")


@router.post("/hr/courses/{cid}/ai-draft")
async def ai_draft(cid: str, account=Depends(hr_account), session: Session = Depends(get_session)):
    """Suggest a description and quiz for the current draft. Nothing is saved automatically."""
    from app.main import guarded_ai

    course = course_doc(session, cid).payload
    if course["status"] not in {"draft", "changes_requested"}:
        raise HTTPException(409, "AI-черновик доступен только для черновика")
    if not settings.ai_enabled or not settings.openai_api_key:
        return {"mode": "rules", "message": "AI не подключён. Заполните описание и тест вручную."}
    skills, _, _ = bundle(session)
    names = {s["skill_id"]: s for s in skills["skills"]}
    draft = course["draft"]
    context = {
        "title": draft["title"],
        "type": draft["type"],
        "format": draft["format"],
        "duration_hours": draft["duration_hours"],
        "audience": {"roles": draft["target_roles"], "grades": draft["target_grades"]},
        "skills": [
            {
                "skill_id": g["skill_id"],
                "name": names[g["skill_id"]]["name"],
                "description": names[g["skill_id"]].get("description", ""),
            }
            for g in draft["develops_skills"]
        ],
    }
    result = await guarded_ai(session, "course-draft-v1", context, ai.draft_course)
    if "error" in result:
        return {"mode": "rules", "message": result["error"]}
    return {"mode": "ai", "suggestion": result["payload"], "cached": result["cached"]}


def published_course(session, event_id):
    events = session.get(Document, "catalog:events").payload["events"]
    event = next((e for e in events if e["event_id"] == event_id), None)
    if not event or not event.get("course_id") or not event.get("has_quiz"):
        raise HTTPException(404, "Для этого мероприятия нет теста")
    course = course_doc(session, event["course_id"]).payload
    quiz = next(
        (h["quiz"] for h in course.get("published_quizzes", []) if h["event_id"] == event_id),
        None,
    )
    if not quiz:
        raise HTTPException(404, "Для этого мероприятия нет теста")
    return event, quiz


@router.get("/courses/{event_id}/quiz")
def get_quiz(
    event_id: str, account=Depends(current_account), session: Session = Depends(get_session)
):
    event, quiz = published_course(session, event_id)
    return {
        "event_id": event_id,
        "title": event["title"],
        "pass_score": quiz["pass_score"],
        "questions": [
            {"question": q["question"], "options": q["options"]} for q in quiz["questions"]
        ],
    }


@router.post("/employees/{eid}/quiz/{event_id}")
def take_quiz(
    eid: str,
    event_id: str,
    body: Attempt,
    account=Depends(current_account),
    session: Session = Depends(get_session),
):
    if account.employee_id != eid:
        raise HTTPException(403, "Тест проходит сам сотрудник")
    event, quiz = published_course(session, event_id)
    attempts = [
        d.payload
        for d in session.exec(select(Document).where(Document.kind == "quiz_attempt")).all()
        if d.payload["employee_id"] == eid and d.payload["event_id"] == event_id
    ]
    if any(a["passed"] for a in attempts):
        raise HTTPException(409, "Тест уже сдан")
    if len(attempts) >= MAX_ATTEMPTS:
        raise HTTPException(409, f"Использованы все {MAX_ATTEMPTS} попытки. Обратитесь к HR")
    if len(body.answers) != len(quiz["questions"]):
        raise HTTPException(422, "Ответьте на все вопросы")
    correct = sum(a == q["correct"] for a, q in zip(body.answers, quiz["questions"], strict=True))
    score = round(100 * correct / len(quiz["questions"]))
    passed = score >= quiz["pass_score"]
    attempt = {
        "employee_id": eid,
        "event_id": event_id,
        "score": score,
        "passed": passed,
        "attempt": len(attempts) + 1,
        "at": now(),
    }
    session.add(Document(id=f"quiz_attempt:{uuid4()}", kind="quiz_attempt", payload=attempt))
    session.add(Audit(actor=account.username, action="quiz_attempted", target=event_id))
    session.commit()
    completion = None
    if passed and event["format"] == "self_paced":
        from app.main import request_completion
        from app.schemas import CompletionRequest

        as_of = session.get(Document, "catalog:skills").payload["meta"]["as_of_date"]
        completion = request_completion(
            eid,
            CompletionRequest(
                event_id=event_id,
                completed_at=as_of,
                evidence=f"Тест «{event['title']}» пройден: {score}% (порог {quiz['pass_score']}%)",
            ),
            account,
            session,
        ).model_dump()
    return {
        **attempt,
        "pass_score": quiz["pass_score"],
        "attempts_left": MAX_ATTEMPTS - attempt["attempt"],
        "completion": completion,
    }
