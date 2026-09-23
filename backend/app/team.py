from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, select

from app.db import get_session
from app.domain import current_skills, gap_rows, readiness, recommendations
from app.insights import NO_STEP, growth_readiness, no_step_reason, participation
from app.models import Account, Audit, Completion, Document, now
from app.onboarding import elapsed_months, needs_assessment, onboarding_data, profile_readiness
from app.security import current_account, hr_account, readable_employee, team_department
from app.seed import bundle

router = APIRouter(prefix="/api")
DEFAULT_POLICY = {"inactivity_days": 90, "grade_months": 18, "misses": 3}


class Policy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    inactivity_days: int = Field(ge=30, le=730, strict=True)
    grade_months: int = Field(ge=3, le=120, strict=True)
    misses: int = Field(ge=1, le=20, strict=True)


class DevelopmentPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: Literal["discussion", "active", "paused", "closed"]
    owner: str = Field(min_length=1, max_length=80)
    next_review_on: date | None = None
    note: str = Field(min_length=8, max_length=1500)
    revision: int = Field(default=0, ge=0)


class GradePeriod(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    grade_since: date
    note: str = Field(min_length=8, max_length=1000)
    revision: int = Field(default=0, ge=0)


def document_payload(session, key):
    doc = session.get(Document, key)
    return doc.payload if doc else None


def policy_data(session):
    return document_payload(session, "support:policy") or DEFAULT_POLICY


def plan_data(session, eid):
    return document_payload(session, f"development_plan:{eid}")


def grade_data(session, employee, metadata=None, records=None):
    key = f"career_period:{employee['employee_id']}"
    record = records.get(key) if records is not None else document_payload(session, key)
    if record and (record["role"], record["grade"]) == (employee["role"], employee["grade"]):
        return record
    start = (metadata or {}).get("grade_since")
    return {"grade_since": start, "revision": 0, "history": []}


@router.put("/hr/support-policy")
def update_policy(
    body: Policy, account=Depends(hr_account), session: Session = Depends(get_session)
):
    session.merge(Document(id="support:policy", kind="support_policy", payload=body.model_dump()))
    session.add(
        Audit(actor=account.username, action="support_policy_changed", target="support:policy")
    )
    session.commit()
    return body


@router.put("/hr/employees/{eid}/development-plan")
def update_plan(
    eid: str,
    body: DevelopmentPlan,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    employee = readable_employee(eid, account, session)
    session.refresh(employee, with_for_update=True)
    owner = session.get(Account, body.owner)
    if not owner or owner.role != "hr":
        raise HTTPException(422, "Ответственным должен быть существующий HR-партнёр")
    as_of = session.get(Document, "catalog:skills").payload["meta"]["as_of_date"]
    if body.status != "closed" and (
        body.next_review_on is None or body.next_review_on.isoformat() < as_of
    ):
        raise HTTPException(422, "Для открытого плана нужна следующая встреча не раньше даты среза")
    previous = plan_data(session, eid)
    if body.revision != (previous or {}).get("revision", 0):
        raise HTTPException(409, "План уже изменён. Обновите профиль и повторите.")
    payload = {
        **body.model_dump(mode="json"),
        "revision": body.revision + 1,
        "updated_by": account.username,
        "updated_at": now(),
    }
    session.merge(Document(id=f"development_plan:{eid}", kind="development_plan", payload=payload))
    session.add(Audit(actor=account.username, action="development_plan_changed", target=eid))
    session.commit()
    return payload


@router.put("/hr/employees/{eid}/grade-period")
def update_grade_period(
    eid: str,
    body: GradePeriod,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    doc = readable_employee(eid, account, session)
    session.refresh(doc, with_for_update=True)
    employee = doc.payload
    as_of = session.get(Document, "catalog:skills").payload["meta"]["as_of_date"]
    if not employee["hire_date"] <= body.grade_since.isoformat() <= as_of:
        raise HTTPException(422, "Дата грейда должна быть между наймом и датой среза")
    previous = grade_data(session, employee, onboarding_data(session, eid))
    if body.revision != previous.get("revision", 0):
        raise HTTPException(409, "Дата уже изменена. Обновите профиль и повторите.")
    change = {
        "grade_since": body.grade_since.isoformat(),
        "note": body.note,
        "reviewer": account.username,
        "recorded_at": now(),
    }
    payload = {
        **change,
        "role": employee["role"],
        "grade": employee["grade"],
        "revision": body.revision + 1,
        "history": [*previous.get("history", []), change],
    }
    session.merge(Document(id=f"career_period:{eid}", kind="career_period", payload=payload))
    session.add(Audit(actor=account.username, action="grade_period_recorded", target=eid))
    session.commit()
    return payload


def build_overview(account, session):
    department = team_department(account, session)
    skills, events, history = bundle(session)
    employees = [
        d.payload for d in session.exec(select(Document).where(Document.kind == "employee")).all()
    ]
    if department is not None:
        employees = [e for e in employees if e["department"] == department]
    as_of = skills["meta"]["as_of_date"]
    policy = policy_data(session)
    cutoff = (date.fromisoformat(as_of) - timedelta(days=policy["inactivity_days"])).isoformat()
    # Load once for the whole authorized team, avoiding per-employee database requests.
    records = {
        d.id: d.payload
        for d in session.exec(
            select(Document).where(
                Document.kind.in_(["onboarding", "development_plan", "career_period"])
            )
        ).all()
    }
    by_employee = {}
    for row in history:
        if row["date"] <= as_of:
            by_employee.setdefault(row["employee_id"], []).append(row)
    skill_names = {s["skill_id"]: s for s in skills["skills"]}
    focus = {}
    for o in session.exec(select(Document).where(Document.kind == "observation")).all():
        o = o.payload
        if o["kind"] == "development" and o["status"] == "confirmed":
            focus.setdefault(o["employee_id"], set()).add(o["skill_id"])
    pending = session.exec(select(Completion).where(Completion.status == "pending")).all()
    waiting = {}
    for c in pending:
        waiting.setdefault(c.employee_id, set()).add(c.event_id)
    profiles = {(p["role"], p["grade"]): p for p in skills["role_profiles"]}
    rows, totals = [], {}
    for employee in employees:
        eid = employee["employee_id"]
        metadata = records.get(f"onboarding:{eid}")
        own = by_employee.get(eid, [])
        levels = current_skills(employee, own, events, as_of)
        gaps = gap_rows(employee, levels, skills["role_profiles"], skill_names)
        assessed = [g for g in gaps if g["assessed"]] if metadata else gaps
        for gap in assessed:
            if gap["gap"]:
                totals[gap["name"]] = totals.get(gap["name"], 0) + 1
        recent = [r for r in own if r["date"] >= cutoff and not events[r["event_id"]]["mandatory"]]
        misses = sum(r["status"] == "no_show" for r in recent)
        plan = records.get(f"development_plan:{eid}")
        paused = bool(
            plan
            and plan["status"] == "paused"
            and plan.get("next_review_on")
            and plan["next_review_on"] >= as_of
        )
        grade = grade_data(session, employee, metadata, records)
        months = elapsed_months(grade["grade_since"], as_of) if grade["grade_since"] else None
        signals = []
        if needs_assessment(metadata):
            signals.append("Нужна первичная оценка навыков")
        if not employee["career_goal"]:
            signals.append("HR ещё не назначил цель")
        if not paused and misses >= policy["misses"]:
            signals.append(
                f"{misses} неявки за {policy['inactivity_days']} дней: обсудить расписание"
            )
        if not paused and not recent and not needs_assessment(metadata):
            signals.append(
                f"Нет записей о добровольном развитии за {policy['inactivity_days']} дней; уточнить полноту данных"
            )
        if months is not None and months >= policy["grade_months"]:
            signals.append(f"{months} мес. на текущем грейде: обсудить дальнейший маршрут")
        review_due = bool(
            plan
            and plan["status"] != "closed"
            and plan.get("next_review_on")
            and plan["next_review_on"] <= as_of
        )
        if review_due:
            signals.append("Наступила дата следующего рассмотрения плана")
        severe = sum(g["critical"] and g["gap"] >= 2 and g["assessed"] for g in gaps)
        critical = sum(g["critical"] and g["gap"] > 0 and g["assessed"] for g in gaps)
        if severe >= 2:
            signals.append(f"Подтверждённых критичных разрывов от двух уровней: {severe}")
        priority = (
            "high"
            if review_due or (severe >= 2 and not paused)
            else "medium"
            if signals
            else "planned"
        )
        if paused and not review_due:
            priority = "planned"
        latest = {}
        for row in sorted(own, key=lambda r: (r["date"], r["record_id"])):
            latest[row["event_id"]] = row
        mandatory_overdue = sum(
            events[r["event_id"]]["mandatory"]
            and r["status"] != "completed"
            and (r["status"] == "overdue" or bool(r.get("due_date") and r["due_date"] < as_of))
            for r in latest.values()
        )
        ready = profile_readiness(gaps, metadata, readiness)
        blocked = needs_assessment(metadata)
        steps = (
            []
            if blocked
            else recommendations(
                employee,
                levels,
                assessed,
                events,
                own,
                as_of,
                waiting.get(eid, ()),
                focus.get(eid, ()),
            )
        )
        reason = (
            None
            if steps
            else no_step_reason(
                employee, levels, assessed, events, own, as_of, waiting.get(eid, ()), blocked
            )
        )
        rows.append(
            {
                "employee_id": eid,
                "full_name": employee["full_name"],
                "department": employee["department"],
                "role": employee["role"],
                "grade": employee["grade"],
                "goal": employee["career_goal"],
                "readiness": ready,
                "next_steps": len(steps),
                "no_step": {"code": reason, "text": NO_STEP[reason]} if reason else None,
                "growth": growth_readiness(
                    employee,
                    levels,
                    assessed,
                    own,
                    events,
                    as_of,
                    profiles.get((employee["role"], employee["grade"])),
                    ready,
                ),
                "signals": signals,
                "priority": priority,
                "critical_gaps": critical,
                "grade_since": grade["grade_since"],
                "grade_months": months,
                "plan": plan,
                "paused": paused,
                "mandatory_overdue": mandatory_overdue,
            }
        )
    ranks = {"high": 0, "medium": 1, "planned": 2}
    rows.sort(key=lambda r: (ranks[r["priority"]], -r["critical_gaps"], r["full_name"]))
    ids = {e["employee_id"] for e in employees}
    names = {e["employee_id"]: e["full_name"] for e in employees}
    return {
        "employees": rows,
        "total": len(rows),
        "department": department,
        "departments": sorted({e["department"] for e in employees}),
        "without_goal": sum(not e["career_goal"] for e in employees),
        "priorities": {p: sum(r["priority"] == p for r in rows) for p in ranks},
        "growth_ready": sum(bool(r["growth"] and r["growth"]["ready"]) for r in rows),
        "no_step": sum(r["no_step"] is not None for r in rows),
        "no_step_reasons": sorted(
            (
                {"code": code, "text": NO_STEP[code], "count": n}
                for code in NO_STEP
                if (n := sum(bool(r["no_step"]) and r["no_step"]["code"] == code for r in rows))
            ),
            key=lambda r: -r["count"],
        ),
        "activities": participation(ids, history, events, as_of),
        "policy": policy,
        "as_of": as_of,
        "hr_owners": [
            a.username for a in session.exec(select(Account).where(Account.role == "hr")).all()
        ]
        if account.role == "hr"
        else [],
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
            if c.employee_id in ids and account.role == "hr"
        ],
    }


@router.get("/team/overview")
def team_overview(account=Depends(current_account), session: Session = Depends(get_session)):
    return build_overview(account, session)
