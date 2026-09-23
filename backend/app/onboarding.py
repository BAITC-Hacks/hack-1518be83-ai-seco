"""HR-owned onboarding. Imported baselines are never overwritten by this workflow."""

import secrets
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db import get_session
from app.models import Account, Audit, Document, now
from app.schemas import InitialAssessment, NewEmployee
from app.security import hr_account, password_hash
from app.seed import bundle, validate_import

router = APIRouter(prefix="/api/hr", tags=["HR onboarding"])


def elapsed_months(start: str, end: str) -> int:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return max(0, (b.year - a.year) * 12 + b.month - a.month - (b.day < a.day))


def onboarding_data(session, eid):
    doc = session.get(Document, f"onboarding:{eid}")
    return doc.payload if doc else None


def needs_assessment(metadata):
    return bool(metadata and metadata["status"] == "pending_assessment")


def profile_readiness(gaps, metadata, calculate):
    if needs_assessment(metadata) or (metadata and any(not g["assessed"] for g in gaps)):
        return None
    return calculate(gaps)


@router.post("/onboarding", status_code=201)
def create_employee(
    body: NewEmployee, account=Depends(hr_account), session: Session = Depends(get_session)
):
    skills, events, _ = bundle(session)
    as_of = skills["meta"]["as_of_date"]
    hire_date = body.hire_date.isoformat()
    grade_since = body.grade_since.isoformat() if body.grade_since else None
    if hire_date > as_of or (grade_since and not hire_date <= grade_since <= as_of):
        raise HTTPException(422, "Проверьте дату найма и дату получения текущего грейда")
    if session.get(Document, f"employee:{body.employee_id}"):
        raise HTTPException(409, "Сотрудник с таким ID уже существует")
    if body.manager_id and not session.get(Document, f"employee:{body.manager_id}"):
        raise HTTPException(422, "Руководитель с таким ID не найден")
    employee = {
        **body.model_dump(mode="json", exclude={"specialization", "grade_since", "create_account"}),
        "tenure_months": elapsed_months(hire_date, as_of),
        "skills": {},
        "career_goal": None,
        # Required by the organizer's import schema; NOT a completed assessment.
        # The explicit pending status blocks recommendations until HR records a baseline.
        "last_review_date": hire_date,
    }
    try:
        parsed, _ = validate_import(
            [employee], [], {"skills": skills, "events": {"events": list(events.values())}}
        )
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)[:1000]) from exc
    access = None
    if body.create_account:
        username = f"cq_{body.employee_id.lower()}"
        if session.get(Account, username):
            raise HTTPException(409, "Логин для этого ID уже занят. Выберите другой ID")
        password = secrets.token_urlsafe(18)
        session.add(
            Account(
                username=username,
                password_hash=password_hash.hash(password),
                role="employee",
                employee_id=body.employee_id,
            )
        )
        access = {"username": username, "password": password}
        session.add(
            Audit(
                actor=account.username, action="employee_account_created", target=body.employee_id
            )
        )
    session.add(Document(id=f"employee:{body.employee_id}", kind="employee", payload=parsed[0]))
    session.add(
        Document(
            id=f"onboarding:{body.employee_id}",
            kind="onboarding",
            payload={
                "employee_id": body.employee_id,
                "status": "pending_assessment",
                "specialization": body.specialization,
                "grade_since": grade_since,
                "created_by": account.username,
                "created_at": now(),
                "assessment_id": None,
            },
        )
    )
    session.add(Audit(actor=account.username, action="employee_created", target=body.employee_id))
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "Этот профиль или логин уже создан другим запросом") from exc
    # A generated password is returned only here, never in profiles, audit or history.
    return {"employee_id": body.employee_id, "access": access}


@router.post("/employees/{eid}/initial-assessment", status_code=201)
def initial_assessment(
    eid: str,
    body: InitialAssessment,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    employee = session.exec(
        select(Document).where(Document.id == f"employee:{eid}").with_for_update()
    ).first()
    if not employee:
        raise HTTPException(404, "Сотрудник не найден")
    metadata = session.get(Document, f"onboarding:{eid}")
    if not metadata or not needs_assessment(metadata.payload):
        raise HTTPException(
            409, "Исходная оценка уже существует. Повторная аттестация — отдельный процесс"
        )
    skills, _, _ = bundle(session)
    assessed_on = body.assessed_on.isoformat()
    if not employee.payload["hire_date"] <= assessed_on <= skills["meta"]["as_of_date"]:
        raise HTTPException(422, "Дата оценки должна быть между наймом и срезом демо")
    known = {s["skill_id"] for s in skills["skills"]}
    supplied = [r.skill_id for r in body.ratings]
    if len(set(supplied)) != len(supplied) or set(supplied) - known:
        raise HTTPException(422, "Повторяющиеся или неизвестные навыки")
    ident = f"assessment:{uuid4()}"
    record = {
        **body.model_dump(mode="json"),
        "employee_id": eid,
        "reviewer": account.username,
        "recorded_at": now(),
    }
    session.add(Document(id=ident, kind="assessment", payload=record))
    employee.payload = {
        **employee.payload,
        "skills": {r.skill_id: r.level for r in body.ratings},
        "last_review_date": assessed_on,
    }
    metadata.payload = {**metadata.payload, "status": "assessed", "assessment_id": ident}
    session.add(employee)
    session.add(metadata)
    session.add(Audit(actor=account.username, action="initial_assessment_recorded", target=eid))
    session.commit()
    return {"employee_id": eid, "assessment": record}
