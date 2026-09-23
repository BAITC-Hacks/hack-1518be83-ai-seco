import csv
import json

from pwdlib import PasswordHash
from sqlmodel import Session, select

from app.config import settings
from app.db import engine
from app.models import Account, Document
from app.schemas import Employee, HistoryRow


def validate_import(employees, history, catalog, known_employees=()):
    parsed = [Employee.model_validate(e).model_dump(mode="json") for e in employees]
    rows = [HistoryRow.model_validate(r).model_dump(mode="json") for r in history]
    employee_ids = {e["employee_id"] for e in parsed}
    if len(employee_ids) != len(parsed) or len({r["record_id"] for r in rows}) != len(rows):
        raise ValueError("Повторяющиеся идентификаторы в файле")
    profiles = {(p["role"], p["grade"]) for p in catalog["skills"]["role_profiles"]}
    skill_ids = {s["skill_id"] for s in catalog["skills"]["skills"]}
    event_ids = {e["event_id"] for e in catalog["events"]["events"]}
    as_of = catalog["skills"]["meta"]["as_of_date"]
    for e in parsed:
        goal = e.get("career_goal")
        if (e["role"], e["grade"]) not in profiles or (
            goal and (goal["target_role"], goal["target_grade"]) not in profiles
        ):
            raise ValueError("Роль или грейд отсутствуют в матрице компетенций")
        if set(e["skills"]) - skill_ids:
            raise ValueError("Неизвестный навык")
        if e["hire_date"] > as_of or not e["hire_date"] <= e["last_review_date"] <= as_of:
            raise ValueError("Даты сотрудника выходят за допустимый период")
    for row in rows:
        if (
            row["employee_id"] not in employee_ids | set(known_employees)
            or row["event_id"] not in event_ids
        ):
            raise ValueError("История ссылается на неизвестного сотрудника или мероприятие")
        if row["date"] > as_of:
            raise ValueError("История содержит запись после даты среза")
    return parsed, rows


def seed(session):
    if session.get(Document, "catalog:skills"):
        return
    path = settings.dataset_path
    catalog = {
        kind: json.loads((path / f"{kind}.json").read_text()) for kind in ("skills", "events")
    }
    employees = json.loads((path / "employees.json").read_text())["employees"]
    with (path / "activity_history.csv").open(newline="", encoding="utf-8-sig") as source:
        history = list(csv.DictReader(source))
    employees, history = validate_import(employees, history, catalog)
    for kind, payload in catalog.items():
        session.add(Document(id=f"catalog:{kind}", kind="catalog", payload=payload))
    for e in employees:
        session.add(Document(id=f"employee:{e['employee_id']}", kind="employee", payload=e))
    for r in history:
        session.add(Document(id=f"history:{r['record_id']}", kind="history", payload=r))
    password = PasswordHash.recommended().hash(settings.demo_password)
    employee_id = (
        "E0002"
        if any(e["employee_id"] == "E0002" for e in employees)
        else employees[0]["employee_id"]
    )
    for username, role, eid in [("employee", "employee", employee_id), ("hr", "hr", None)]:
        if not session.get(Account, username):
            session.add(
                Account(username=username, role=role, employee_id=eid, password_hash=password)
            )
    session.commit()


def bundle(session):
    skills = session.get(Document, "catalog:skills").payload
    events = session.get(Document, "catalog:events").payload
    history = [
        d.payload for d in session.exec(select(Document).where(Document.kind == "history")).all()
    ]
    completed = {}
    for row in history:
        if row["status"] == "completed":
            completed.setdefault((row["employee_id"], row["event_id"]), []).append(row["date"])
    # A confirmed completion supersedes enrollment in the effective view, not in stored source data.
    history = [
        r
        for r in history
        if r["status"] != "in_progress"
        or not any(
            d == r["date"] if r["event_id"] == "EV_036" else d >= r["date"]
            for d in completed.get((r["employee_id"], r["event_id"]), [])
        )
    ]
    return skills, {e["event_id"]: e for e in events["events"]}, history


def seed_demo_manager(session):
    # Explicit local-demo scope; existing accounts are never silently broadened.
    if session.get(Account, "manager"):
        return
    person = session.get(Document, "employee:E0050")
    if not person:
        return
    session.add(
        Account(
            username="manager",
            role="manager",
            employee_id="E0050",
            password_hash=PasswordHash.recommended().hash(settings.demo_password),
        )
    )
    session.add(
        Document(
            id="manager_scope:manager",
            kind="manager_scope",
            payload={"department": person.payload["department"]},
        )
    )
    session.commit()


def seed_demo_expert(session):
    # A second HR account so drafts, reassessments and rewards get a four-eyes review.
    if session.get(Account, "expert"):
        return
    session.add(
        Account(
            username="expert",
            role="hr",
            employee_id=None,
            password_hash=PasswordHash.recommended().hash(settings.demo_password),
        )
    )
    session.commit()


if __name__ == "__main__":
    with Session(engine) as session:
        seed(session)
        seed_demo_manager(session)
        seed_demo_expert(session)
