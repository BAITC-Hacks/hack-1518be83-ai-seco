"""Rewards with HR approval. Only voluntary development counts; no money in the demo.

HR publishes a catalog with explicit criteria. The server verifies facts when an employee
claims a reward and stores them with the criterion version. HR approves, asks for changes
or rejects with a comment; issuing is a separate step. A reward is issued at most once per
employee, and mandatory processes never earn one.
"""

from datetime import date, timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, select

from app.db import get_session
from app.models import Audit, Document, now
from app.onboarding import needs_assessment, onboarding_data
from app.security import current_account, hr_account, readable_employee
from app.seed import bundle

router = APIRouter(prefix="/api", tags=["Rewards"])
OPEN = {"pending", "approved", "needs_changes"}
DEMO_REWARDS = [
    {
        "title": "Книга по профессии",
        "description": "Профессиональная книга на выбор из списка HR.",
        "kind": "book",
        "criterion": {"type": "voluntary_completions", "count": 3, "period_days": 365},
    },
    {
        "title": "Доступ к продвинутому обучению",
        "description": "Оплачиваемый внешний курс по навыку из вашей цели.",
        "kind": "learning",
        "criterion": {"type": "goal_readiness", "percent": 80},
    },
    {
        "title": "Участие в профильной конференции",
        "description": "Билет на отраслевую конференцию по согласованию с руководителем.",
        "kind": "conference",
        "criterion": {"type": "goal_critical_closed"},
    },
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Criterion(Strict):
    type: Literal[
        "voluntary_completions", "course_completed", "goal_readiness", "goal_critical_closed"
    ]
    count: int | None = Field(default=None, ge=1, le=20)
    period_days: int | None = Field(default=None, ge=30, le=730)
    event_id: str | None = None
    percent: int | None = Field(default=None, ge=50, le=100)


class RewardBody(Strict):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=600)
    kind: Literal["book", "learning", "conference", "other"]
    criterion: Criterion
    active: bool = True


class Decision(Strict):
    decision: Literal["approved", "needs_changes", "rejected"]
    note: str = Field(min_length=3, max_length=1000)


class Note(Strict):
    note: str = Field(default="", max_length=1000)


def describe(c):
    return {
        "voluntary_completions": f"Завершить {c.get('count')} добровольных мероприятия за {c.get('period_days')} дней",
        "course_completed": f"Завершить мероприятие {c.get('event_id')}",
        "goal_readiness": f"Готовность к цели от {c.get('percent')}%",
        "goal_critical_closed": "Закрыть все критичные навыки своей цели",
    }[c["type"]]


def validate_criterion(c, session):
    c = c.model_dump(exclude_none=True)
    required = {
        "voluntary_completions": {"count", "period_days"},
        "course_completed": {"event_id"},
        "goal_readiness": {"percent"},
        "goal_critical_closed": set(),
    }[c["type"]]
    if set(c) - {"type"} != required:
        raise HTTPException(422, "Укажите параметры, подходящие типу критерия")
    if c["type"] == "course_completed":
        events = {e["event_id"]: e for e in bundle(session)[1].values()}
        if c["event_id"] not in events or events[c["event_id"]]["mandatory"]:
            raise HTTPException(422, "Награда даётся только за добровольное мероприятие")
    return c


def check(employee, criterion, session):
    """Server-side facts for a criterion. Returns (met, facts, progress)."""
    from app.main import profile_data

    data = profile_data(employee, session)
    skills, events, history = bundle(session)
    as_of = skills["meta"]["as_of_date"]
    own = [r for r in history if r["employee_id"] == employee["employee_id"] and r["date"] <= as_of]
    voluntary = [
        r for r in own if r["status"] == "completed" and not events[r["event_id"]]["mandatory"]
    ]
    kind = criterion["type"]
    if kind == "voluntary_completions":
        start = (date.fromisoformat(as_of) - timedelta(days=criterion["period_days"])).isoformat()
        done = sorted(
            (r for r in voluntary if r["date"] >= start), key=lambda r: r["date"], reverse=True
        )
        facts = [f"{events[r['event_id']]['title']} · {r['date']}" for r in done]
        return len(done) >= criterion["count"], facts, f"{len(done)} из {criterion['count']}"
    if kind == "course_completed":
        done = [r for r in voluntary if r["event_id"] == criterion["event_id"]]
        facts = [f"{events[r['event_id']]['title']} · {r['date']}" for r in done]
        return bool(done), facts, "завершено" if done else "не завершено"
    if needs_assessment(onboarding_data(session, employee["employee_id"])) or not employee.get(
        "career_goal"
    ):
        return False, [], "нужна назначенная HR цель и оценка навыков"
    goal = employee["career_goal"]
    if kind == "goal_readiness":
        ready = data["readiness"]
        return (
            ready is not None and ready >= criterion["percent"],
            [f"Готовность к {goal['target_role']} · {goal['target_grade']}: {ready}%"],
            f"{ready}% из {criterion['percent']}%",
        )
    critical = [g for g in data["gaps"] if g["critical"]]
    closed = [g for g in critical if g["gap"] == 0]
    facts = [f"{g['name']}: {g['current']} из {g['required']}" for g in critical]
    return (
        bool(critical) and len(closed) == len(critical),
        facts,
        f"{len(closed)} из {len(critical)}",
    )


def rewards(session, include_inactive=False):
    docs = session.exec(select(Document).where(Document.kind == "reward")).all()
    items = sorted((d.payload for d in docs), key=lambda r: r["created_at"])
    return [r for r in items if include_inactive or r["active"]]


def claims(session, eid=None):
    docs = session.exec(select(Document).where(Document.kind == "reward_claim")).all()
    return [d.payload for d in docs if eid is None or d.payload["employee_id"] == eid]


def claim_doc(session, cid):
    doc = session.exec(
        select(Document).where(Document.id == f"reward_claim:{cid}").with_for_update()
    ).first()
    if not doc:
        raise HTTPException(404, "Заявка не найдена")
    return doc


def step(claim, status, actor, note=""):
    return {
        **claim,
        "status": status,
        "updated_at": now(),
        "history": [
            *claim["history"],
            {"status": status, "actor": actor, "note": note, "at": now()},
        ],
    }


def employee_only(eid, account, session):
    if account.employee_id != eid:
        raise HTTPException(403, "Заявку подаёт и меняет сам сотрудник")
    return readable_employee(eid, account, session).payload


@router.get("/rewards/{eid}")
def my_rewards(eid: str, account=Depends(current_account), session: Session = Depends(get_session)):
    if account.role == "manager":
        raise HTTPException(403, "Награды видят сотрудник и HR")
    employee = readable_employee(eid, account, session).payload
    own = claims(session, eid)
    items = []
    for r in rewards(session):
        met, facts, progress = check(employee, r["criterion"], session)
        mine = sorted(
            (c for c in own if c["reward_id"] == r["reward_id"]), key=lambda c: c["created_at"]
        )
        items.append(
            {
                **r,
                "rule": describe(r["criterion"]),
                "eligible": met,
                "facts": facts,
                "progress": progress,
                "claim": mine[-1] if mine else None,
            }
        )
    return {"rewards": items, "claims": sorted(own, key=lambda c: c["created_at"], reverse=True)}


@router.post("/employees/{eid}/rewards/{rid}/claim", status_code=201)
def claim_reward(
    eid: str,
    rid: str,
    body: Note,
    account=Depends(current_account),
    session: Session = Depends(get_session),
):
    doc = session.exec(
        select(Document).where(Document.id == f"employee:{eid}").with_for_update()
    ).first()
    employee = employee_only(eid, account, session)
    reward = next((r for r in rewards(session) if r["reward_id"] == rid), None)
    if not reward or not doc:
        raise HTTPException(404, "Награда не найдена или не активна")
    previous = [c for c in claims(session, eid) if c["reward_id"] == rid]
    if any(c["status"] == "issued" for c in previous):
        raise HTTPException(409, "Эта награда уже выдана")
    if any(c["status"] in OPEN for c in previous):
        raise HTTPException(409, "Заявка на эту награду уже рассматривается")
    met, facts, progress = check(employee, reward["criterion"], session)
    if not met:
        raise HTTPException(422, f"Условие пока не выполнено: {progress}")
    cid = uuid4().hex[:12]
    claim = {
        "claim_id": cid,
        "employee_id": eid,
        "full_name": employee["full_name"],
        "reward_id": rid,
        "reward_title": reward["title"],
        "criterion": reward["criterion"],
        "criterion_version": reward["version"],
        "facts": facts,
        "comment": body.note,
        "status": "pending",
        "created_at": now(),
        "updated_at": now(),
        "history": [
            {"status": "pending", "actor": account.username, "note": body.note, "at": now()}
        ],
    }
    session.add(Document(id=f"reward_claim:{cid}", kind="reward_claim", payload=claim))
    session.add(Audit(actor=account.username, action="reward_claimed", target=cid))
    session.commit()
    return claim


@router.post("/employees/{eid}/reward-claims/{cid}/{action}")
def employee_action(
    eid: str,
    cid: str,
    action: Literal["cancel", "resubmit"],
    body: Note,
    account=Depends(current_account),
    session: Session = Depends(get_session),
):
    employee = employee_only(eid, account, session)
    doc = claim_doc(session, cid)
    claim = doc.payload
    if claim["employee_id"] != eid:
        raise HTTPException(404, "Заявка не найдена")
    if action == "cancel":
        if claim["status"] not in {"pending", "needs_changes"}:
            raise HTTPException(409, "Отменить можно только нерассмотренную заявку")
        doc.payload = step(claim, "cancelled", account.username, body.note)
    else:
        if claim["status"] != "needs_changes":
            raise HTTPException(409, "Повторно отправить можно только заявку на доработке")
        met, facts, progress = check(employee, claim["criterion"], session)
        if not met:
            raise HTTPException(422, f"Условие пока не выполнено: {progress}")
        doc.payload = {**step(claim, "pending", account.username, body.note), "facts": facts}
    session.add(doc)
    session.add(Audit(actor=account.username, action=f"reward_{action}", target=cid))
    session.commit()
    return doc.payload


@router.get("/hr/rewards")
def hr_rewards(account=Depends(hr_account), session: Session = Depends(get_session)):
    return {
        "rewards": [{**r, "rule": describe(r["criterion"])} for r in rewards(session, True)],
        "claims": sorted(claims(session), key=lambda c: c["updated_at"], reverse=True),
    }


@router.post("/hr/rewards", status_code=201)
def create_reward(
    body: RewardBody, account=Depends(hr_account), session: Session = Depends(get_session)
):
    rid = uuid4().hex[:10]
    reward = {
        **body.model_dump(exclude={"criterion"}),
        "criterion": validate_criterion(body.criterion, session),
        "reward_id": rid,
        "version": 1,
        "created_by": account.username,
        "created_at": now(),
    }
    session.add(Document(id=f"reward:{rid}", kind="reward", payload=reward))
    session.add(Audit(actor=account.username, action="reward_created", target=rid))
    session.commit()
    return reward


@router.put("/hr/rewards/{rid}")
def update_reward(
    rid: str, body: RewardBody, account=Depends(hr_account), session: Session = Depends(get_session)
):
    doc = session.exec(
        select(Document).where(Document.id == f"reward:{rid}").with_for_update()
    ).first()
    if not doc:
        raise HTTPException(404, "Награда не найдена")
    criterion = validate_criterion(body.criterion, session)
    old = doc.payload
    doc.payload = {
        **old,
        **body.model_dump(exclude={"criterion"}),
        "criterion": criterion,
        # Existing claims keep the criterion version they were checked against.
        "version": old["version"] + (criterion != old["criterion"]),
        "updated_by": account.username,
    }
    session.add(doc)
    session.add(Audit(actor=account.username, action="reward_updated", target=rid))
    session.commit()
    return doc.payload


@router.post("/hr/reward-claims/{cid}/decision")
def decide(
    cid: str, body: Decision, account=Depends(hr_account), session: Session = Depends(get_session)
):
    doc = claim_doc(session, cid)
    if doc.payload["status"] != "pending":
        raise HTTPException(409, "Решение по заявке уже принято")
    doc.payload = {
        **step(doc.payload, body.decision, account.username, body.note),
        "decided_by": account.username,
    }
    session.add(doc)
    session.add(Audit(actor=account.username, action=f"reward_{body.decision}", target=cid))
    session.commit()
    return doc.payload


@router.post("/hr/reward-claims/{cid}/issue")
def issue(
    cid: str, body: Note, account=Depends(hr_account), session: Session = Depends(get_session)
):
    doc = claim_doc(session, cid)
    claim = doc.payload
    if claim["status"] != "approved":
        raise HTTPException(409, "Выдать можно только одобренную заявку")
    already = [
        c
        for c in claims(session, claim["employee_id"])
        if c["reward_id"] == claim["reward_id"] and c["status"] == "issued"
    ]
    if already:
        raise HTTPException(409, "Эта награда уже выдана сотруднику")
    doc.payload = {
        **step(claim, "issued", account.username, body.note),
        "issued_by": account.username,
    }
    session.add(doc)
    session.add(Audit(actor=account.username, action="reward_issued", target=cid))
    session.commit()
    return doc.payload


def seed_demo_rewards(session):
    if rewards(session, True):
        return
    for item in DEMO_REWARDS:
        rid = uuid4().hex[:10]
        session.add(
            Document(
                id=f"reward:{rid}",
                kind="reward",
                payload={
                    **item,
                    "active": True,
                    "reward_id": rid,
                    "version": 1,
                    "created_by": "hr",
                    "created_at": now(),
                },
            )
        )
    session.commit()
