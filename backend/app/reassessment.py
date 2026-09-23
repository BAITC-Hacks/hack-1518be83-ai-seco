"""Repeat assessment: a new, attributed baseline that never overwrites the original one.

The imported profile and the initial assessment stay untouched. A confirmed reassessment is
stored separately and overlaid as the effective baseline: its levels and date replace the
previous baseline, and only completions after that date are added on top. Confirmation
requires a second HR expert.
"""

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, select

from app.db import get_session
from app.domain import current_skills
from app.models import Audit, Document, now
from app.onboarding import needs_assessment, onboarding_data
from app.schemas import InitialAssessment
from app.security import current_account, hr_account, readable_employee
from app.seed import bundle

router = APIRouter(prefix="/api", tags=["Reassessment"])


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    decision: Literal["confirmed", "rejected"]
    note: str = Field(min_length=3, max_length=1000)


def reassessments(session, eid=None):
    rows = [
        d.payload
        for d in session.exec(select(Document).where(Document.kind == "reassessment")).all()
    ]
    return [r for r in rows if eid is None or r["employee_id"] == eid]


def latest_baselines(session):
    latest = {}
    for r in reassessments(session):
        if r["status"] == "confirmed" and (
            r["employee_id"] not in latest
            or (r["assessed_on"], r["confirmed_at"])
            > (latest[r["employee_id"]]["assessed_on"], latest[r["employee_id"]]["confirmed_at"])
        ):
            latest[r["employee_id"]] = r
    return latest


def effective(employee, baseline):
    if not baseline:
        return employee
    return {**employee, "skills": baseline["baseline"], "last_review_date": baseline["assessed_on"]}


def effective_employee(session, employee):
    return effective(employee, latest_baselines(session).get(employee["employee_id"]))


def comparison(record, names):
    return [
        {
            "skill_id": r["skill_id"],
            "name": names.get(r["skill_id"], r["skill_id"]),
            "before": record["before"].get(r["skill_id"], 0),
            "after": r["level"],
            "delta": r["level"] - record["before"].get(r["skill_id"], 0),
            "evidence": r["evidence"],
        }
        for r in record["ratings"]
    ]


@router.post("/hr/employees/{eid}/reassessments", status_code=201)
def propose(
    eid: str,
    body: InitialAssessment,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    doc = readable_employee(eid, account, session)
    session.refresh(doc, with_for_update=True)
    if needs_assessment(onboarding_data(session, eid)):
        raise HTTPException(409, "Сначала проведите первичную оценку навыков")
    if any(r["status"] == "proposed" for r in reassessments(session, eid)):
        raise HTTPException(409, "Предыдущая аттестация ещё ждёт решения")
    skills, events, history = bundle(session)
    employee = effective_employee(session, doc.payload)
    assessed_on = body.assessed_on.isoformat()
    if not employee["last_review_date"] < assessed_on <= skills["meta"]["as_of_date"]:
        raise HTTPException(
            422, "Дата аттестации должна быть позже текущей оценки и не позже даты среза"
        )
    known = {s["skill_id"] for s in skills["skills"]}
    supplied = [r.skill_id for r in body.ratings]
    if len(set(supplied)) != len(supplied) or set(supplied) - known:
        raise HTTPException(422, "Повторяющиеся или неизвестные навыки")
    own = [r for r in history if r["employee_id"] == eid]
    before = current_skills(employee, own, events, assessed_on)
    record = {
        **body.model_dump(mode="json"),
        "reassessment_id": uuid4().hex[:12],
        "employee_id": eid,
        "status": "proposed",
        "before": {s: before.get(s, 0) for s in supplied},
        "previous_review_date": employee["last_review_date"],
        "proposed_by": account.username,
        "proposed_at": now(),
    }
    session.add(
        Document(
            id=f"reassessment:{record['reassessment_id']}", kind="reassessment", payload=record
        )
    )
    session.add(Audit(actor=account.username, action="reassessment_proposed", target=eid))
    session.commit()
    return record


@router.post("/hr/reassessments/{rid}/decision")
def decide(
    rid: str, body: Decision, account=Depends(hr_account), session: Session = Depends(get_session)
):
    doc = session.exec(
        select(Document).where(Document.id == f"reassessment:{rid}").with_for_update()
    ).first()
    if not doc:
        raise HTTPException(404, "Аттестация не найдена")
    record = doc.payload
    if record["status"] != "proposed":
        raise HTTPException(409, "Решение по аттестации уже принято")
    if record["proposed_by"] == account.username:
        raise HTTPException(403, "Аттестацию подтверждает другой HR-эксперт")
    employee = session.exec(
        select(Document).where(Document.id == f"employee:{record['employee_id']}").with_for_update()
    ).one()
    payload = {
        **record,
        "status": body.decision,
        "decided_by": account.username,
        "decision_note": body.note,
        "confirmed_at": now(),
    }
    if body.decision == "confirmed":
        # Full effective baseline at the assessment date: completions up to that date are
        # already reflected in it, rated skills take the new levels.
        _, events, history = bundle(session)
        current = effective_employee(session, employee.payload)
        own = [r for r in history if r["employee_id"] == record["employee_id"]]
        levels = current_skills(current, own, events, record["assessed_on"])
        payload["baseline"] = {**levels, **{r["skill_id"]: r["level"] for r in record["ratings"]}}
    doc.payload = payload
    session.add(doc)
    session.add(Audit(actor=account.username, action=f"reassessment_{body.decision}", target=rid))
    session.commit()
    return payload


@router.get("/employees/{eid}/reassessments")
def list_reassessments(
    eid: str, account=Depends(current_account), session: Session = Depends(get_session)
):
    readable_employee(eid, account, session)
    names = {s["skill_id"]: s["name"] for s in bundle(session)[0]["skills"]}
    rows = []
    for r in sorted(reassessments(session, eid), key=lambda r: r["proposed_at"], reverse=True):
        row = {
            k: r.get(k)
            for k in (
                "reassessment_id",
                "status",
                "assessed_on",
                "method",
                "previous_review_date",
                "proposed_by",
                "decided_by",
                "confirmed_at",
            )
        }
        row["comparison"] = comparison(r, names)
        if account.role == "manager":
            # Managers see the outcome, not the private grounds of the assessment.
            for c in row["comparison"]:
                c["evidence"] = None
        else:
            row["note"] = r["note"]
            row["decision_note"] = r.get("decision_note")
        rows.append(row)
    return rows
