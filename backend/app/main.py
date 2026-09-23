import csv
import hashlib
import io
import json
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app import ai
from app.config import settings
from app.db import get_session
from app.domain import current_skills, gap_rows, readiness, recommendations
from app.evidence import confirmed_focus
from app.evidence import router as evidence_router
from app.models import AIBudget, AICache, Audit, Completion, Document, now
from app.onboarding import (
    elapsed_months,
    needs_assessment,
    onboarding_data,
    profile_readiness,
)
from app.onboarding import (
    router as onboarding_router,
)
from app.schemas import CompletionRequest, Employee, Goal, Login, Review
from app.security import create_token, current_account, hr_account, password_hash
from app.seed import bundle, validate_import

app = FastAPI(title="Career Quest", version="0.1.0")
app.include_router(onboarding_router)
app.include_router(evidence_router)


@app.middleware("http")
async def protect_origin(request: Request, call_next):
    origin = request.headers.get("origin")
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and origin
        and urlparse(origin).netloc != request.headers.get("host")
    ):
        return JSONResponse({"detail": "Cross-origin writes are disabled"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health(session: Session = Depends(get_session)):
    if not session.get(Document, "catalog:skills"):
        raise HTTPException(503, "Датасет ещё не загружен")
    return {"status": "ok"}


@app.post("/api/auth/login")
def login(body: Login, response: Response, session: Session = Depends(get_session)):
    from app.models import Account

    account = session.get(Account, body.username)
    if not account or not password_hash.verify(body.password, account.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    response.set_cookie(
        "quest_session",
        create_token(account.username),
        httponly=True,
        samesite="strict",
        max_age=14400,
    )
    return {"username": account.username, "role": account.role, "employee_id": account.employee_id}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("quest_session")
    return {"ok": True}


@app.get("/api/me")
def me(account=Depends(current_account)):
    return {"username": account.username, "role": account.role, "employee_id": account.employee_id}


@app.get("/api/catalog")
def catalog(account=Depends(current_account), session: Session = Depends(get_session)):
    skills, events, _ = bundle(session)
    return {
        "as_of": skills["meta"]["as_of_date"],
        "skills": skills["skills"],
        "proficiency_scale": skills.get("proficiency_scale", {}),
        "profiles": skills["role_profiles"],
        "events": list(events.values()),
        "ai_available": bool(settings.ai_enabled and settings.openai_api_key),
        "demo": True,
    }


def employee_document(eid, account, session):
    if account.role != "hr" and account.employee_id != eid:
        raise HTTPException(403, "Можно просматривать только свой профиль")
    doc = session.get(Document, f"employee:{eid}")
    if not doc:
        raise HTTPException(404, "Сотрудник не найден")
    return doc


def profile_data(employee, session, data=None):
    skills, events, history = data or bundle(session)
    as_of = skills["meta"]["as_of_date"]
    history = [r for r in history if r["employee_id"] == employee["employee_id"]]
    levels = current_skills(employee, history, events, as_of)
    gaps = gap_rows(
        employee, levels, skills["role_profiles"], {s["skill_id"]: s for s in skills["skills"]}
    )
    completions = session.exec(
        select(Completion).where(Completion.employee_id == employee["employee_id"])
    ).all()
    pending = {c.event_id for c in completions if c.status == "pending"}
    metadata = onboarding_data(session, employee["employee_id"])
    assessed_gaps = [g for g in gaps if g["assessed"]] if metadata else gaps
    recs = (
        []
        if needs_assessment(metadata)
        else recommendations(
            employee,
            levels,
            assessed_gaps,
            events,
            history,
            as_of,
            pending,
            confirmed_focus(session, employee["employee_id"]),
        )
    )
    assessment = (
        session.get(Document, metadata["assessment_id"])
        if metadata and metadata.get("assessment_id")
        else None
    )
    return {
        "employee": employee,
        "levels": levels,
        "gaps": gaps,
        "readiness": profile_readiness(gaps, metadata, readiness),
        "recommendations": recs,
        "history": sorted(
            [
                {
                    **r,
                    "title": events[r["event_id"]]["title"],
                    "format": events[r["event_id"]]["format"],
                }
                for r in history
            ],
            key=lambda r: r["date"],
            reverse=True,
        ),
        "completions": [
            {**c.model_dump(), "title": events[c.event_id]["title"]} for c in completions
        ],
        "as_of": as_of,
        "mode": "rules",
        "grade_since": metadata.get("grade_since") if metadata else None,
        "grade_months": elapsed_months(metadata["grade_since"], as_of)
        if metadata and metadata.get("grade_since")
        else None,
        "onboarding": metadata,
        "assessment": assessment.payload if assessment else None,
        "notice": "Расчёт по правилам, не AI. Самостоятельные курсы в исходной истории датированы зачислением; прирост после оценки приблизительный. Готовность не гарантирует повышение.",
    }


@app.get("/api/employees/{eid}")
def profile(eid: str, account=Depends(current_account), session: Session = Depends(get_session)):
    return profile_data(employee_document(eid, account, session).payload, session)


@app.put("/api/employees/{eid}/goal")
def goal(
    eid: str,
    body: Goal | None = None,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    doc = employee_document(eid, account, session)
    # Refresh under the same employee lock used by initial assessment/history writes.
    # A concurrent goal change must not overwrite a freshly recorded skill baseline.
    session.refresh(doc, with_for_update=True)
    if body and needs_assessment(onboarding_data(session, eid)):
        raise HTTPException(409, "Сначала проведите первичную оценку навыков")
    skills, _, _ = bundle(session)
    if body and not any(
        p["role"] == body.target_role and p["grade"] == body.target_grade
        for p in skills["role_profiles"]
    ):
        raise HTTPException(422, "Цель отсутствует в матрице")
    doc.payload = {**doc.payload, "career_goal": body.model_dump() if body else None}
    session.add(doc)
    session.add(Audit(actor=account.username, action="goal_changed", target=eid))
    session.commit()
    return {"ok": True}


@app.post("/api/employees/{eid}/completions")
def request_completion(
    eid: str,
    body: CompletionRequest,
    account=Depends(current_account),
    session: Session = Depends(get_session),
):
    doc = employee_document(eid, account, session)
    session.refresh(doc, with_for_update=True)
    if needs_assessment(onboarding_data(session, eid)):
        raise HTTPException(409, "Сначала HR должен провести первичную оценку навыков")
    skills, events, history = bundle(session)
    event = events.get(body.event_id)
    done_date = body.completed_at.isoformat()
    if not event or event["mandatory"]:
        raise HTTPException(422, "Здесь подтверждаются только добровольные мероприятия")
    e = doc.payload
    if e["role"] not in event["target_roles"] or e["grade"] not in event["target_grades"]:
        raise HTTPException(422, "Мероприятие не подходит аудитории сотрудника")
    if not e["last_review_date"] < done_date <= skills["meta"]["as_of_date"]:
        raise HTTPException(422, "Дата должна быть после последней оценки и не позже среза демо")
    relevant = [r for r in history if r["employee_id"] == eid and r["event_id"] == body.event_id]
    if any(
        r["status"] == "completed" and (body.event_id != "EV_036" or r["date"] == done_date)
        for r in relevant
    ):
        raise HTTPException(409, "Это завершение уже учтено")
    if (
        event["format"] != "self_paced"
        and done_date not in event["upcoming_sessions"]
        and not any(r["date"] == done_date for r in relevant)
    ):
        raise HTTPException(422, "Дата не соответствует известной сессии мероприятия")
    levels = current_skills(e, history, events, done_date)
    if any(levels.get(sid, 0) < minimum for sid, minimum in event["prerequisites"].items()):
        raise HTTPException(422, "Не выполнены предпосылки участия")
    occurrence = done_date if body.event_id == "EV_036" else "once"
    existing = session.exec(
        select(Completion).where(
            Completion.employee_id == eid,
            Completion.event_id == body.event_id,
            Completion.occurrence == occurrence,
        )
    ).first()
    if existing:
        return existing
    item = Completion(
        employee_id=eid,
        event_id=body.event_id,
        occurrence=occurrence,
        completed_at=done_date,
        evidence=body.evidence,
    )
    session.add(item)
    session.add(Audit(actor=account.username, action="completion_requested", target=item.id))
    session.commit()
    session.refresh(item)
    return item


@app.get("/api/hr/overview")
def overview(account=Depends(hr_account), session: Session = Depends(get_session)):
    skills, events, history = bundle(session)
    employees = [
        d.payload for d in session.exec(select(Document).where(Document.kind == "employee")).all()
    ]
    as_of = skills["meta"]["as_of_date"]
    cutoff = (date.fromisoformat(as_of) - timedelta(days=90)).isoformat()
    by_employee = {}
    for row in history:
        by_employee.setdefault(row["employee_id"], []).append(row)
    rows, totals = [], {}
    onboarding = {
        d.payload["employee_id"]: d.payload
        for d in session.exec(select(Document).where(Document.kind == "onboarding")).all()
    }
    for e in employees:
        metadata = onboarding.get(e["employee_id"])
        own = by_employee.get(e["employee_id"], [])
        levels = current_skills(e, own, events, as_of)
        gaps = gap_rows(
            e, levels, skills["role_profiles"], {s["skill_id"]: s for s in skills["skills"]}
        )
        for gap in gaps:
            if gap["gap"] and (not metadata or gap["assessed"]):
                totals[gap["name"]] = totals.get(gap["name"], 0) + 1
        recent = [
            r
            for r in own
            if cutoff <= r["date"] <= as_of and not events[r["event_id"]]["mandatory"]
        ]
        misses = sum(r["status"] == "no_show" for r in recent)
        signals = []
        if needs_assessment(metadata):
            signals.append("Нужна первичная оценка навыков")
        if not e["career_goal"]:
            signals.append("Цель пока не выбрана")
        if misses >= 3:
            signals.append(f"{misses} неявки за 90 дней: обсудить расписание")
        if not recent and not needs_assessment(metadata):
            signals.append(
                "Нет записей о добровольном развитии за 90 дней; уточнить полноту данных"
            )
        rows.append(
            {
                "employee_id": e["employee_id"],
                "full_name": e["full_name"],
                "role": e["role"],
                "grade": e["grade"],
                "goal": e["career_goal"],
                "readiness": profile_readiness(gaps, metadata, readiness),
                "signals": signals,
                "grade_since": metadata.get("grade_since") if metadata else None,
                "grade_months": elapsed_months(metadata["grade_since"], as_of)
                if metadata and metadata.get("grade_since")
                else None,
            }
        )
    pending = session.exec(select(Completion).where(Completion.status == "pending")).all()
    names = {e["employee_id"]: e["full_name"] for e in employees}
    return {
        "employees": rows,
        "total": len(rows),
        "without_goal": sum(not e["career_goal"] for e in employees),
        "gaps": sorted(
            [{"name": k, "count": v} for k, v in totals.items()], key=lambda r: -r["count"]
        )[:5],
        "pending": [
            {
                **c.model_dump(),
                "full_name": names[c.employee_id],
                "title": events[c.event_id]["title"],
            }
            for c in pending
        ],
        "as_of": as_of,
    }


@app.post("/api/hr/completions/{cid}/review")
def review(
    cid: str, body: Review, account=Depends(hr_account), session: Session = Depends(get_session)
):
    item = session.exec(select(Completion).where(Completion.id == cid).with_for_update()).first()
    if not item:
        raise HTTPException(404, "Заявка не найдена")
    if item.status != "pending":
        if item.status == body.decision:
            return item
        raise HTTPException(409, "Заявка уже рассмотрена")
    session.exec(
        select(Document).where(Document.id == f"employee:{item.employee_id}").with_for_update()
    ).one()
    if body.decision == "approved":
        payload = {
            "record_id": f"CQ_{item.id}",
            "employee_id": item.employee_id,
            "event_id": item.event_id,
            "date": item.completed_at,
            "completed_at": item.completed_at,
            "due_date": None,
            "status": "completed",
            "completion_pct": 100,
            "score": None,
            "feedback_rating": None,
            "assigned_by": "self",
            "source": "hr_confirmed",
        }
        # Refuse a second gain if a completion was imported while this request was pending.
        for row in session.exec(select(Document).where(Document.kind == "history")).all():
            if (
                row.payload["employee_id"] == item.employee_id
                and row.payload["event_id"] == item.event_id
                and row.payload["status"] == "completed"
                and (item.event_id != "EV_036" or row.payload["date"] == item.completed_at)
            ):
                raise HTTPException(
                    409, "Завершение уже появилось в истории. Отклоните дублирующую заявку."
                )
        session.add(Document(id=f"history:{payload['record_id']}", kind="history", payload=payload))
    item.status, item.reviewer, item.reviewed_at, item.review_note = (
        body.decision,
        account.username,
        now(),
        body.note,
    )
    session.add(item)
    session.add(Audit(actor=account.username, action=f"completion_{body.decision}", target=cid))
    session.commit()
    session.refresh(item)
    return item


def save_import(session, account, employees, history):
    skills, events, _ = bundle(session)
    existing = {
        d.payload["employee_id"]
        for d in session.exec(select(Document).where(Document.kind == "employee")).all()
    }
    try:
        parsed, rows = validate_import(
            employees,
            history,
            {"skills": skills, "events": {"events": list(events.values())}},
            existing,
        )
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)[:1500]) from exc
    # Share the employee lock with completion approval, preserving a consistent history.
    for eid in sorted({r["employee_id"] for r in rows} & existing):
        session.exec(
            select(Document).where(Document.id == f"employee:{eid}").with_for_update()
        ).one()
    inserted = 0
    for kind, items, key in [("employee", parsed, "employee_id"), ("history", rows, "record_id")]:
        for payload in items:
            ident = f"{kind}:{payload[key]}"
            previous = session.get(Document, ident)
            if previous:
                if previous.payload != payload:
                    raise HTTPException(
                        409,
                        f"{payload[key]} уже существует с другими данными. Импорт ничего не перезаписывает.",
                    )
                continue
            session.add(Document(id=ident, kind=kind, payload=payload))
            inserted += 1
    session.add(
        Audit(
            actor=account.username,
            action="data_imported",
            target=f"{len(parsed)} profiles/{len(rows)} history",
        )
    )
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "Данные уже импортированы другим запросом") from exc
    return {"inserted": inserted, "employees": len(parsed), "history": len(rows)}


@app.post("/api/hr/employees", status_code=201)
def create_employee(
    body: Employee, account=Depends(hr_account), session: Session = Depends(get_session)
):
    return save_import(session, account, [body.model_dump(mode="json")], [])


@app.post("/api/hr/import")
async def import_data(
    employees: UploadFile | None = None,
    history: UploadFile | None = None,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    if not employees and not history:
        raise HTTPException(422, "Выберите JSON профилей и/или CSV истории")
    payloads = {}
    for kind, file in [("employees", employees), ("history", history)]:
        if file:
            raw = await file.read(5_000_001)
            if len(raw) > 5_000_000:
                raise HTTPException(413, "Лимит файла — 5 МБ")
            payloads[kind] = raw
    try:
        profiles = json.loads(payloads["employees"])["employees"] if employees else []
        if not isinstance(profiles, list):
            raise ValueError("employees must be an array")
        rows = (
            list(csv.DictReader(io.StringIO(payloads["history"].decode("utf-8-sig"))))
            if history
            else []
        )
    except (ValueError, KeyError, TypeError, UnicodeError) as exc:
        raise HTTPException(422, "Нужны исходная схема employees.json и UTF-8 CSV истории") from exc
    return save_import(session, account, profiles, rows)


@app.post("/api/employees/{eid}/ai-explanation")
async def ai_explanation(
    eid: str, account=Depends(current_account), session: Session = Depends(get_session)
):
    employee = employee_document(eid, account, session).payload
    if not settings.ai_enabled or not settings.openai_api_key:
        return {
            "mode": "rules",
            "message": "AI не подключён. Работает проверяемый подбор по правилам.",
            "explanations": {},
        }
    data = profile_data(employee, session)
    candidates = data["recommendations"]
    if not candidates:
        return {
            "mode": "rules",
            "message": "Нет подходящих мероприятий для AI-объяснения",
            "explanations": {},
        }
    context = {
        "role": employee["role"],
        "grade": employee["grade"],
        "goal": employee["career_goal"],
        "candidates": [
            {
                k: c[k]
                for k in (
                    "event_id",
                    "title",
                    "duration_hours",
                    "benefits",
                    "past_misses",
                    "reason",
                )
            }
            for c in candidates
        ],
    }
    # No employee names, IDs, source documents or private feedback are sent to the model.
    key = hashlib.sha256(
        json.dumps([settings.openai_model, "v1", context], sort_keys=True).encode()
    ).hexdigest()
    cached = session.get(AICache, key)
    if cached:
        return {"mode": "ai", "explanations": cached.payload, "cached": True}
    day = datetime.now(UTC).date().isoformat()
    if not session.get(AIBudget, day):
        try:
            session.add(AIBudget(day=day))
            session.commit()
        except IntegrityError:
            session.rollback()
    updated = session.execute(
        update(AIBudget)
        .where(AIBudget.day == day, AIBudget.calls < settings.ai_daily_limit)
        .values(calls=AIBudget.calls + 1)
    )
    session.commit()
    if updated.rowcount != 1:
        return {
            "mode": "rules",
            "message": "Дневной лимит AI-запросов исчерпан",
            "explanations": {},
        }
    try:
        explanations = await ai.explain(context)
    except Exception:
        return {
            "mode": "rules",
            "message": "AI не ответил корректно за отведённое время. Сохранён подбор по правилам.",
            "explanations": {},
        }
    session.merge(AICache(id=key, payload=explanations))
    session.commit()
    return {"mode": "ai", "explanations": explanations, "cached": False}


if settings.frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
