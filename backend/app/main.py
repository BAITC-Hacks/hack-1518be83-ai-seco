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

from app import ai, integrations
from app.analytics import employee_facts, growth_readiness, latest_by_event, support_priority
from app.config import settings
from app.db import get_session
from app.domain import (
    current_skills,
    find_profile,
    gap_rows,
    profile_gaps,
    readiness,
    recommendations,
    target_profile,
)
from app.models import AIBudget, AICache, Audit, Completion, Connection, Document, now
from app.schemas import CompletionRequest, ConnectRequest, Employee, Goal, Login, Review
from app.security import create_token, current_account, hr_account, password_hash, staff_account
from app.seed import bundle, validate_import

app = FastAPI(title="Career Quest", version="0.1.0")


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
    return account_view(account, session)


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("quest_session")
    return {"ok": True}


def account_view(account, session):
    doc = session.get(Document, f"employee:{account.employee_id}") if account.employee_id else None
    return {
        "username": account.username,
        "role": account.role,
        "employee_id": account.employee_id,
        "full_name": doc.payload["full_name"] if doc else None,
        "department": doc.payload["department"] if doc else None,
    }


@app.get("/api/me")
def me(account=Depends(current_account), session: Session = Depends(get_session)):
    return account_view(account, session)


@app.get("/api/catalog")
def catalog(account=Depends(current_account), session: Session = Depends(get_session)):
    skills, events, _ = bundle(session)
    return {
        "as_of": skills["meta"]["as_of_date"],
        "skills": skills["skills"],
        "profiles": skills["role_profiles"],
        "events": list(events.values()),
        "ai_available": bool(settings.ai_enabled and settings.openai_api_key),
        "demo": True,
    }


def manager_department(account, session):
    doc = session.get(Document, f"employee:{account.employee_id}") if account.employee_id else None
    return doc.payload["department"] if doc else None


def employee_document(eid, account, session, write=False):
    doc = session.get(Document, f"employee:{eid}")
    own = account.employee_id == eid
    in_department = (
        account.role == "manager"
        and doc is not None
        and doc.payload["department"] == manager_department(account, session)
    )
    if not (account.role == "hr" or own or in_department):
        raise HTTPException(403, "Можно просматривать только свой профиль")
    if write and account.role == "manager" and not own:
        raise HTTPException(403, "Руководитель видит профиль сотрудника, но не меняет его")
    if not doc:
        raise HTTPException(404, "Сотрудник не найден")
    return doc


def team_members(account, session):
    employees = [
        d.payload for d in session.exec(select(Document).where(Document.kind == "employee")).all()
    ]
    if account.role == "manager":
        department = manager_department(account, session)
        employees = [e for e in employees if e["department"] == department]
    return employees


def connections_for(session, eid=None):
    query = (
        select(Connection)
        if eid is None
        else select(Connection).where(Connection.employee_id == eid)
    )
    result = {}
    for c in session.exec(query).all():
        result.setdefault(c.employee_id, {})[c.source] = {
            "resources": c.resources,
            "synced_at": c.synced_at,
        }
    return result


def role_skills(skills, employee):
    profile = find_profile(skills["role_profiles"], employee["role"], employee["grade"])
    return list(profile["required_skills"]) if profile else []


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
    recs = recommendations(employee, levels, gaps, events, history, as_of, pending)
    orientation = None
    if not employee.get("career_goal"):
        # Shown as a hint only; the employee still chooses the goal and gets no recommendations.
        target, _ = target_profile(employee, skills["role_profiles"])
        if target:
            hint = profile_gaps(target, levels, {s["skill_id"]: s for s in skills["skills"]})
            orientation = {
                "role": target["role"],
                "grade": target["grade"],
                "readiness": readiness(hint),
            }
    described = [
        {
            **r,
            "title": events[r["event_id"]]["title"],
            "format": events[r["event_id"]]["format"],
            "mandatory": events[r["event_id"]]["mandatory"],
        }
        for r in history
    ]
    open_ids = {
        r["record_id"]
        for r in latest_by_event(history)
        if r["status"] != "completed"
        and (events[r["event_id"]]["mandatory"] or r["status"] == "in_progress")
    }
    return {
        "employee": employee,
        "levels": levels,
        "gaps": gaps,
        "readiness": readiness(gaps),
        "orientation": orientation,
        "recommendations": recs,
        "history": sorted(described, key=lambda r: r["date"], reverse=True),
        "learning": {
            "open": sorted(
                (r for r in described if r["record_id"] in open_ids),
                key=lambda r: r["date"],
                reverse=True,
            ),
        },
        "completions": [
            {**c.model_dump(), "title": events[c.event_id]["title"]} for c in completions
        ],
        "as_of": as_of,
        "mode": "rules",
        "grade_since": None,
        "notice": "Расчёт по правилам, не AI. Самостоятельные курсы в исходной истории датированы зачислением; прирост после оценки приблизительный. Готовность не гарантирует повышение.",
    }


@app.get("/api/employees/{eid}")
def profile(eid: str, account=Depends(current_account), session: Session = Depends(get_session)):
    return profile_data(employee_document(eid, account, session).payload, session)


@app.put("/api/employees/{eid}/goal")
def goal(
    eid: str,
    body: Goal | None = None,
    account=Depends(current_account),
    session: Session = Depends(get_session),
):
    doc = employee_document(eid, account, session, write=True)
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
    doc = employee_document(eid, account, session, write=True)
    # Lock employee to serialize completion/history mutations.
    session.exec(select(Document).where(Document.id == doc.id).with_for_update()).one()
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
    for e in employees:
        own = by_employee.get(e["employee_id"], [])
        levels = current_skills(e, own, events, as_of)
        gaps = gap_rows(
            e, levels, skills["role_profiles"], {s["skill_id"]: s for s in skills["skills"]}
        )
        for gap in gaps:
            if gap["gap"]:
                totals[gap["name"]] = totals.get(gap["name"], 0) + 1
        recent = [
            r
            for r in own
            if cutoff <= r["date"] <= as_of and not events[r["event_id"]]["mandatory"]
        ]
        misses = sum(r["status"] == "no_show" for r in recent)
        signals = []
        if not e["career_goal"]:
            signals.append("Цель пока не выбрана")
        if misses >= 3:
            signals.append(f"{misses} неявки за 90 дней: обсудить расписание")
        if not recent:
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
                "readiness": readiness(gaps),
                "signals": signals,
                "grade_since": None,
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
    result = await guarded_ai(session, "v1", context, ai.explain)
    if "error" in result:
        return {"mode": "rules", "message": result["error"], "explanations": {}}
    return {"mode": "ai", "explanations": result["payload"], "cached": result["cached"]}


async def guarded_ai(session, version, context, call):
    """Shared cache, daily call budget and failure handling for every model call."""
    key = hashlib.sha256(
        json.dumps([settings.openai_model, version, context], sort_keys=True).encode()
    ).hexdigest()
    cached = session.get(AICache, key)
    if cached:
        return {"payload": cached.payload, "cached": True}
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
        return {"error": "Дневной лимит AI-запросов исчерпан"}
    try:
        payload = await call(context)
    except Exception:
        return {
            "error": "AI не ответил корректно за отведённое время. Сохранён подбор по правилам."
        }
    session.merge(AICache(id=key, payload=payload))
    session.commit()
    return {"payload": payload, "cached": False}


def by_employee(history):
    grouped = {}
    for row in history:
        grouped.setdefault(row["employee_id"], []).append(row)
    return grouped


@app.get("/api/team/overview")
def team_overview(
    department: str | None = None,
    role: str | None = None,
    account=Depends(staff_account),
    session: Session = Depends(get_session),
):
    skills, events, history = bundle(session)
    as_of = skills["meta"]["as_of_date"]
    skill_names = {s["skill_id"]: s for s in skills["skills"]}
    scope = team_members(account, session)
    people = [
        e
        for e in scope
        if (not department or e["department"] == department) and (not role or e["role"] == role)
    ]
    grouped, conns = by_employee(history), connections_for(session)
    discussed = {
        a.target
        for a in session.exec(select(Audit).where(Audit.action == "signal_discussed")).all()
    }
    rows, gap_counts, insights = [], {}, []
    for e in people:
        eid = e["employee_id"]
        facts = employee_facts(e, grouped.get(eid, []), events, skills, as_of)
        support, growth = support_priority(facts), growth_readiness(facts)
        for gap in facts["gaps"]:
            if gap["gap"]:
                gap_counts[gap["name"]] = gap_counts.get(gap["name"], 0) + 1
        digest = integrations.digest(
            e, conns.get(eid, {}), facts["gaps"], skill_names, role_skills(skills, e)
        )
        if digest["signal"]:
            signal = digest["signal"]
            insights.append(
                {
                    "employee_id": eid,
                    "full_name": e["full_name"],
                    "role": e["role"],
                    "title": signal["title"],
                    "text": signal["text"],
                    "sufficient": signal["sufficient"],
                    "evidence": len(signal["evidence"]),
                    "sources": sorted({x["source"] for x in signal["evidence"]}),
                    "discussed": eid in discussed,
                }
            )
        rows.append(
            {
                "employee_id": eid,
                "full_name": e["full_name"],
                "department": e["department"],
                "role": e["role"],
                "grade": e["grade"],
                "target": facts["target"],
                "readiness": facts["readiness"],
                "coverage": facts["coverage"],
                "gaps": sum(g["gap"] > 0 for g in facts["gaps"]),
                "critical_gaps": sum(g["gap"] > 0 and g["critical"] for g in facts["gaps"]),
                "priority": support,
                "growth": growth,
                "sources": {k: v["status"] for k, v in digest["sources"].items()},
            }
        )
    records = [r for e in people for r in grouped.get(e["employee_id"], [])]
    count = lambda status: sum(r["status"] == status for r in records)  # noqa: E731
    pending = session.exec(select(Completion).where(Completion.status == "pending")).all()
    visible = {e["employee_id"]: e["full_name"] for e in scope}
    return {
        "as_of": as_of,
        "scope": {
            "role": account.role,
            "department": manager_department(account, session)
            if account.role == "manager"
            else None,
            "total": len(scope),
        },
        "departments": sorted({e["department"] for e in scope}),
        "roles": sorted({e["role"] for e in scope}),
        "metrics": {
            "employees": len(people),
            "with_critical_gap": sum(r["critical_gaps"] > 0 for r in rows),
            "avg_readiness": round(sum(r["readiness"] for r in rows) / len(rows)) if rows else None,
            "without_goal": sum(not e.get("career_goal") for e in people),
            "completed": count("completed"),
            "overdue": count("overdue"),
        },
        "priority_counts": {
            level: sum(r["priority"]["level"] == level for r in rows)
            for level in ("high", "medium", "planned")
        },
        "growth_count": sum(r["growth"]["ready"] for r in rows),
        "gaps": sorted(
            [{"name": k, "count": v} for k, v in gap_counts.items()], key=lambda g: -g["count"]
        )[:7],
        "activity": {
            "completed": count("completed"),
            "voluntary_completed": sum(
                r["status"] == "completed" and not events[r["event_id"]]["mandatory"]
                for r in records
            ),
            "no_show": count("no_show"),
            "dropped": count("dropped"),
            "declined": count("declined"),
            "in_progress": count("in_progress"),
        },
        "sources": {
            "github": sum(r["sources"]["github"] == "connected" for r in rows),
            "github_accounts": sum(r["sources"]["github"] != "no_account" for r in rows),
            "jira": sum(r["sources"]["jira"] == "connected" for r in rows),
            "none": sum("connected" not in r["sources"].values() for r in rows),
        },
        "insights": insights,
        "employees": rows,
        # Completion approval stays with HR; managers only see the queue size of their team.
        "pending": [
            {
                **c.model_dump(),
                "full_name": visible[c.employee_id],
                "title": events[c.event_id]["title"],
            }
            for c in pending
            if c.employee_id in visible
        ]
        if account.role == "hr"
        else [],
    }


@app.get("/api/team/employees/{eid}")
def team_card(eid: str, account=Depends(staff_account), session: Session = Depends(get_session)):
    return card_data(eid, account, session)


def card_data(eid, account, session):
    employee = employee_document(eid, account, session).payload
    skills, events, history = bundle(session)
    as_of = skills["meta"]["as_of_date"]
    skill_names = {s["skill_id"]: s for s in skills["skills"]}
    own = [r for r in history if r["employee_id"] == eid]
    facts = employee_facts(employee, own, events, skills, as_of)
    pending = {
        c.event_id
        for c in session.exec(
            select(Completion).where(Completion.employee_id == eid, Completion.status == "pending")
        ).all()
    }
    target = facts["target"]
    oriented = {
        **employee,
        "career_goal": {"target_role": target["role"], "target_grade": target["grade"]},
    }
    recs = recommendations(oriented, facts["levels"], facts["gaps"], events, own, as_of, pending)
    manager = session.get(Document, f"employee:{employee.get('manager_id')}")
    discussed = session.exec(
        select(Audit).where(Audit.action == "signal_discussed", Audit.target == eid)
    ).first()
    return {
        "employee": {
            k: employee[k]
            for k in ("employee_id", "full_name", "department", "role", "grade", "last_review_date")
        },
        "manager": manager.payload["full_name"] if manager else None,
        "target": target,
        "readiness": facts["readiness"],
        "coverage": facts["coverage"],
        "priority": support_priority(facts),
        "growth": growth_readiness(facts),
        "gaps": sorted(facts["gaps"], key=lambda g: (-g["critical"], -g["gap"], g["name"])),
        "recommendations": [
            {
                k: r[k]
                for k in (
                    "event_id",
                    "title",
                    "format",
                    "duration_hours",
                    "next_session",
                    "benefits",
                )
            }
            for r in recs
        ],
        "open_learning": [
            {
                **r,
                "title": events[r["event_id"]]["title"],
                "mandatory": events[r["event_id"]]["mandatory"],
            }
            for r in latest_by_event(own)
            if r["status"] != "completed"
            and (events[r["event_id"]]["mandatory"] or r["status"] == "in_progress")
        ],
        "integrations": integrations.digest(
            employee,
            connections_for(session, eid).get(eid, {}),
            facts["gaps"],
            skill_names,
            role_skills(skills, employee),
        ),
        "discussed": bool(discussed),
        "as_of": as_of,
    }


def briefing_context(card):
    """Facts for the model. No name, ID, department or manager leaves the server."""
    signal = card["integrations"]["signal"]
    return {
        "today": card["as_of"],
        "role": card["employee"]["role"],
        "grade": card["employee"]["grade"],
        "target": {
            "role": card["target"]["role"],
            "grade": card["target"]["grade"],
            "chosen_by_employee": card["target"]["chosen"],
        },
        "readiness_to_target_percent": card["readiness"],
        "current_grade_coverage_percent": card["coverage"],
        "support": {
            "level": card["priority"]["label"],
            "score_points_of_100": card["priority"]["score"],
            "factors": [
                {
                    "factor": f["label"],
                    "points": f["points"],
                    "max": f["weight"] * 100,
                    "fact": f["detail"],
                }
                for f in card["priority"]["factors"]
                if f["points"] > 0
            ],
            "overdue_mandatory": card["priority"]["overdue_mandatory"],
        },
        "growth": {
            "score_points_of_100": card["growth"]["score"],
            "ready_for_promotion_talk": card["growth"]["ready"],
        },
        "gaps": [
            {k: g[k] for k in ("name", "current", "required", "critical")}
            for g in card["gaps"]
            if g["gap"] > 0
        ][:8],
        "recommendations": [
            {
                k: r[k]
                for k in (
                    "event_id",
                    "title",
                    "format",
                    "duration_hours",
                    "next_session",
                    "benefits",
                )
            }
            for r in card["recommendations"]
        ],
        "open_learning": [
            {"title": r["title"], "mandatory": r["mandatory"], "status": r["status"]}
            for r in card["open_learning"]
        ],
        "work_signal": {
            "hypothesis": signal["title"],
            "sufficient_data": signal["sufficient"],
            "episodes": [e["note"] for e in signal["evidence"]][:6],
            "practice_idea": signal["practice"],
        }
        if signal
        else None,
    }


@app.post("/api/team/employees/{eid}/ai-summary")
async def ai_summary(
    eid: str, account=Depends(staff_account), session: Session = Depends(get_session)
):
    card = card_data(eid, account, session)
    if not settings.ai_enabled or not settings.openai_api_key:
        return {"mode": "rules", "message": "AI не подключён. Используйте факторы и выжимку выше."}
    result = await guarded_ai(session, "brief-v3", briefing_context(card), ai.brief)
    if "error" in result:
        return {"mode": "rules", "message": result["error"]}
    return {"mode": "ai", "briefing": result["payload"], "cached": result["cached"]}


@app.post("/api/team/employees/{eid}/discuss")
def mark_discussed(
    eid: str, account=Depends(staff_account), session: Session = Depends(get_session)
):
    employee_document(eid, account, session)
    exists = session.exec(
        select(Audit).where(Audit.action == "signal_discussed", Audit.target == eid)
    ).first()
    if not exists:
        session.add(Audit(actor=account.username, action="signal_discussed", target=eid))
        session.commit()
    return {"ok": True}


def integration_view(employee, account, session):
    skills, events, history = bundle(session)
    as_of = skills["meta"]["as_of_date"]
    eid = employee["employee_id"]
    levels = current_skills(
        employee, [r for r in history if r["employee_id"] == eid], events, as_of
    )
    target, _ = target_profile(employee, skills["role_profiles"])
    skill_names = {s["skill_id"]: s for s in skills["skills"]}
    gaps = profile_gaps(target, levels, skill_names) if target else []
    digest = integrations.digest(
        employee,
        connections_for(session, eid).get(eid, {}),
        gaps,
        skill_names,
        role_skills(skills, employee),
    )
    return {
        "can_manage": account.employee_id == eid,
        "period": integrations.PERIOD_LABEL,
        "sources": {
            source: {
                **digest["sources"][source],
                "available": integrations.available(employee, source),
                "choices": integrations.resources(employee, source),
            }
            for source in integrations.SOURCES
        },
        "signal": digest["signal"],
    }


@app.get("/api/employees/{eid}/integrations")
def employee_integrations(
    eid: str, account=Depends(current_account), session: Session = Depends(get_session)
):
    return integration_view(employee_document(eid, account, session).payload, account, session)


def own_integration(eid, source, account, session):
    if account.employee_id != eid:
        raise HTTPException(403, "Подключениями управляет только сам сотрудник")
    if source not in integrations.SOURCES:
        raise HTTPException(404, "Неизвестный источник")
    return employee_document(eid, account, session).payload


@app.put("/api/employees/{eid}/integrations/{source}")
def connect_integration(
    eid: str,
    source: str,
    body: ConnectRequest,
    account=Depends(current_account),
    session: Session = Depends(get_session),
):
    employee = own_integration(eid, source, account, session)
    if not integrations.available(employee, source):
        raise HTTPException(422, "У сотрудника нет аккаунта GitHub — подключать нечего")
    chosen = list(dict.fromkeys(body.resources))
    if set(chosen) - set(integrations.resources(employee, source)):
        raise HTTPException(422, "Можно выбрать только предложенные демо-ресурсы")
    item = session.exec(
        select(Connection).where(Connection.employee_id == eid, Connection.source == source)
    ).first() or Connection(employee_id=eid, source=source, resources=chosen)
    item.resources, item.consent_at, item.synced_at = chosen, now(), now()
    session.add(item)
    session.add(Audit(actor=account.username, action=f"{source}_connected", target=eid))
    session.commit()
    return integration_view(employee, account, session)


@app.delete("/api/employees/{eid}/integrations/{source}")
def disconnect_integration(
    eid: str, source: str, account=Depends(current_account), session: Session = Depends(get_session)
):
    employee = own_integration(eid, source, account, session)
    item = session.exec(
        select(Connection).where(Connection.employee_id == eid, Connection.source == source)
    ).first()
    if item:
        session.delete(item)
        session.add(Audit(actor=account.username, action=f"{source}_disconnected", target=eid))
        session.commit()
    return integration_view(employee, account, session)


if settings.frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
