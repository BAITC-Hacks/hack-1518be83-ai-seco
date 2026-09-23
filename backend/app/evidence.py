"""Work-evidence analysis: synthetic work samples -> reviewable skill observations.

Deterministic rules find repeated review findings across independent tasks. The optional
LLM only rewrites the wording of already-found observations. Skill levels are never changed
here: a confirmed development area only raises recommendation priority for that skill.
"""

import hashlib
import json
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app import ai
from app.config import settings
from app.db import get_session
from app.domain import apply_gains, current_skills, eligible, gap_rows
from app.models import AIBudget, Audit, Document, now
from app.security import current_account, hr_account
from app.seed import bundle

router = APIRouter(prefix="/api", tags=["Work evidence"])

# Minimum number of independent tasks before a pattern becomes an observation.
MIN_TASKS = 2
Ident = Field(pattern=r"^[A-Za-z0-9_.:#/-]{1,80}$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Criterion(Strict):
    criterion_id: str = Ident
    roles: list[str] = Field(min_length=1)
    skill_id: str
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=3, max_length=500)


class Identity(Strict):
    source: Literal["github", "gitlab", "confluence", "jira"]
    external_id: str = Ident
    employee_id: str
    confirmed_by: str = Field(min_length=2, max_length=80)


class Worklog(Strict):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    hours: float = Field(gt=0, le=24)
    kind: Literal[
        "implementation", "analysis", "testing", "review", "fixes", "communication", "blocked"
    ]


class Task(Strict):
    task_id: str = Ident
    source: Literal["jira"]
    key: str = Ident
    title: str = Field(min_length=3, max_length=200)
    employee_id: str
    acceptance_criteria: list[str] = Field(default_factory=list, max_length=20)
    estimate_hours: float | None = Field(default=None, ge=0, le=1000)
    worklogs: list[Worklog] = Field(default_factory=list, max_length=200)


class Finding(Strict):
    finding_id: str = Ident
    criterion_id: str
    reviewer: str = Field(min_length=2, max_length=80)
    text: str = Field(min_length=5, max_length=600)
    # fixed: addressed after review (still part of the pattern);
    # not_applicable: context showed the remark does not hold (excluded from analysis).
    outcome: Literal["open", "fixed", "not_applicable"] = "open"


class Artifact(Strict):
    artifact_id: str = Ident
    source: Literal["github", "gitlab", "confluence"]
    kind: Literal["pull_request", "merge_request", "page"]
    task_id: str
    author_external_id: str
    co_author_external_ids: list[str] = Field(default_factory=list, max_length=10)
    title: str = Field(min_length=3, max_length=200)
    url: str = Field(max_length=300)
    version: str = Field(min_length=1, max_length=80)
    created_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    excerpt: str = Field(default="", max_length=2000)
    findings: list[Finding] = Field(default_factory=list, max_length=50)
    strengths: list[str] = Field(default_factory=list, max_length=10)


class EvidenceBundle(Strict):
    meta: dict
    criteria: list[Criterion] = Field(max_length=200)
    identities: list[Identity] = Field(max_length=1000)
    tasks: list[Task] = Field(max_length=2000)
    artifacts: list[Artifact] = Field(max_length=5000)


class ObservationReview(Strict):
    decision: Literal["confirmed", "rejected"]
    note: str = Field(min_length=3, max_length=1000)


class ObservationComment(Strict):
    text: str = Field(min_length=3, max_length=1000)


def validate_bundle(raw, session):
    data = EvidenceBundle.model_validate(raw)
    if data.meta.get("synthetic") is not True:
        raise ValueError("Разрешены только синтетические примеры: meta.synthetic = true")
    skills, _, _ = bundle(session)
    skill_ids = {s["skill_id"] for s in skills["skills"]}
    roles = {p["role"] for p in skills["role_profiles"]}
    employees = {
        d.payload["employee_id"]
        for d in session.exec(select(Document).where(Document.kind == "employee")).all()
    }
    for name, items, key in [
        ("criterion", data.criteria, "criterion_id"),
        ("task", data.tasks, "task_id"),
        ("artifact", data.artifacts, "artifact_id"),
    ]:
        ids = [getattr(i, key) for i in items]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Повторяющиеся идентификаторы: {name}")
    identity_keys = [(i.source, i.external_id) for i in data.identities]
    if len(identity_keys) != len(set(identity_keys)):
        raise ValueError("Один внешний аккаунт привязан несколько раз")
    criteria = {c.criterion_id for c in data.criteria}
    tasks = {t.task_id for t in data.tasks}
    for c in data.criteria:
        if c.skill_id not in skill_ids or set(c.roles) - roles:
            raise ValueError(f"Критерий {c.criterion_id}: неизвестный навык или роль")
    for i in data.identities:
        if i.employee_id not in employees:
            raise ValueError(f"Аккаунт {i.external_id} ссылается на неизвестного сотрудника")
    for t in data.tasks:
        if t.employee_id not in employees:
            raise ValueError(f"Задача {t.key} ссылается на неизвестного сотрудника")
    finding_ids = []
    for a in data.artifacts:
        if a.task_id not in tasks:
            raise ValueError(f"{a.artifact_id}: задача {a.task_id} не найдена")
        if {f.criterion_id for f in a.findings} - criteria or set(a.strengths) - criteria:
            raise ValueError(f"{a.artifact_id}: неизвестный критерий")
        finding_ids += [f.finding_id for f in a.findings]
    if len(finding_ids) != len(set(finding_ids)):
        raise ValueError("Повторяющиеся идентификаторы замечаний")
    return data


@router.post("/hr/work-evidence/import")
async def import_evidence(
    file: UploadFile, account=Depends(hr_account), session: Session = Depends(get_session)
):
    raw = await file.read(5_000_001)
    if len(raw) > 5_000_000:
        raise HTTPException(413, "Лимит файла — 5 МБ")
    try:
        data = validate_bundle(json.loads(raw.decode("utf-8-sig")), session)
    except (ValidationError, ValueError, UnicodeError) as exc:
        raise HTTPException(422, str(exc)[:1500]) from exc
    docs = (
        [("work_criterion", c.criterion_id, c) for c in data.criteria]
        + [("work_identity", f"{i.source}:{i.external_id}", i) for i in data.identities]
        + [("work_task", t.task_id, t) for t in data.tasks]
        + [("work_artifact", a.artifact_id, a) for a in data.artifacts]
    )
    inserted = 0
    for kind, key, item in docs:
        payload = item.model_dump(mode="json")
        previous = session.get(Document, f"{kind}:{key}")
        if previous:
            if previous.payload != payload:
                session.rollback()
                raise HTTPException(
                    409, f"{key} уже загружен с другими данными. Импорт ничего не перезаписывает."
                )
            continue
        session.add(Document(id=f"{kind}:{key}", kind=kind, payload=payload))
        inserted += 1
    session.add(
        Audit(
            actor=account.username,
            action="work_evidence_imported",
            target=f"{len(data.tasks)} tasks/{len(data.artifacts)} artifacts",
        )
    )
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "Данные уже импортированы другим запросом") from exc
    return {"inserted": inserted, "tasks": len(data.tasks), "artifacts": len(data.artifacts)}


def load(session, kind):
    return [d.payload for d in session.exec(select(Document).where(Document.kind == kind)).all()]


def work_context(session, eid):
    identities = {
        (i["source"], i["external_id"]): i["employee_id"] for i in load(session, "work_identity")
    }
    tasks = {t["task_id"]: t for t in load(session, "work_task")}
    criteria = {c["criterion_id"]: c for c in load(session, "work_criterion")}
    own, unmatched = [], 0
    for a in load(session, "work_artifact"):
        author = identities.get((a["source"], a["author_external_id"]))
        co = [identities.get((a["source"], x)) for x in a["co_author_external_ids"]]
        if author is None:
            unmatched += 1  # Unknown author is never guessed from names.
            continue
        if eid == author or eid in co:
            role = "author" if eid == author else "co_author"
            shared = bool(a["co_author_external_ids"]) or role == "co_author"
            own.append({**a, "contribution": role, "shared": shared})
    task_ids = {a["task_id"] for a in own} | {
        t["task_id"] for t in tasks.values() if t["employee_id"] == eid
    }
    return own, {k: tasks[k] for k in task_ids if k in tasks}, criteria, unmatched


def fingerprint(items):
    return hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()[:16]


def analyze_rules(eid, artifacts, tasks, criteria):
    """Group findings by criterion across independent tasks. Returns (observations, insufficient)."""
    patterns = {}
    for a in artifacts:
        key = tasks.get(a["task_id"], {}).get("key", a["task_id"])
        for f in a["findings"]:
            if f["outcome"] == "not_applicable":
                continue
            patterns.setdefault((f["criterion_id"], "development"), []).append(
                {
                    "artifact_id": a["artifact_id"],
                    "artifact_title": a["title"],
                    "source": a["source"],
                    "url": a["url"],
                    "version": a["version"],
                    "task_id": a["task_id"],
                    "task_key": key,
                    "finding_id": f["finding_id"],
                    "text": f["text"],
                    "reviewer": f["reviewer"],
                    "outcome": f["outcome"],
                    "shared": a["shared"],
                }
            )
        for cid in a["strengths"]:
            patterns.setdefault((cid, "strength"), []).append(
                {
                    "artifact_id": a["artifact_id"],
                    "artifact_title": a["title"],
                    "source": a["source"],
                    "url": a["url"],
                    "version": a["version"],
                    "task_id": a["task_id"],
                    "task_key": key,
                    "shared": a["shared"],
                }
            )
    observations, insufficient = [], []
    for (cid, kind), evidence in sorted(patterns.items()):
        criterion = criteria[cid]
        # Several remarks in one task are one example, not independent evidence.
        task_keys = sorted({e["task_key"] for e in evidence})
        if len(task_keys) < MIN_TASKS:
            insufficient.append(
                {
                    "criterion_id": cid,
                    "title": criterion["title"],
                    "kind": kind,
                    "tasks": task_keys,
                    "reason": f"Найдено в {len(task_keys)} задаче; нужно не меньше {MIN_TASKS} независимых примеров.",
                }
            )
            continue
        limitations = ["Вывод по синтетическим рабочим примерам, не по реальным данным."]
        shared = sum(e["shared"] for e in evidence)
        if shared:
            limitations.append(
                f"Совместное авторство (примеров: {shared}) — эксперт уточняет личный вклад."
            )
        blocked = sum(
            w["hours"]
            for tid in {e["task_id"] for e in evidence}
            for w in tasks.get(tid, {}).get("worklogs", [])
            if w["kind"] == "blocked"
        )
        if kind == "development" and blocked:
            limitations.append(
                f"Ожидание/блокировки ({blocked:g} ч) не считаются недостатком навыка."
            )
        if kind == "development" and any(e["outcome"] == "fixed" for e in evidence):
            limitations.append("Часть замечаний исправлена после ревью.")
        observations.append(
            {
                "observation_id": f"obs:{eid}:{cid}:{kind}",
                "employee_id": eid,
                "criterion_id": cid,
                "criterion_title": criterion["title"],
                "criterion_description": criterion["description"],
                "skill_id": criterion["skill_id"],
                "kind": kind,
                "task_keys": task_keys,
                "evidence": evidence,
                "limitations": limitations,
                "summary": (
                    f"В {len(task_keys)} независимых задачах ({', '.join(task_keys)}) ревью повторно "
                    f"отмечает критерий «{criterion['title']}»."
                    if kind == "development"
                    else f"В {len(task_keys)} независимых задачах ({', '.join(task_keys)}) "
                    f"рецензенты отмечают сильную сторону: «{criterion['title']}»."
                ),
                "alternative": "",
                "summary_mode": "rules",
                "fingerprint": fingerprint(evidence),
            }
        )
    return observations, insufficient


def reserve_ai_call(session):
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
    return updated.rowcount == 1


async def ai_wording(session, observations):
    """Returns (summaries by observation_id, message). Falls back to rules on any problem."""
    if not observations:
        return {}, "Повторяющихся паттернов не найдено"
    if not settings.ai_enabled or not settings.openai_api_key:
        return {}, "AI не подключён: наблюдения сформированы правилами"
    if not reserve_ai_call(session):
        return {}, "Дневной лимит AI-запросов исчерпан: наблюдения сформированы правилами"
    # Only criteria and review excerpts are sent: no names, employee IDs or source URLs.
    context = [
        {
            "observation_id": o["observation_id"].split(":", 2)[2],
            "kind": o["kind"],
            "criterion": o["criterion_title"],
            "criterion_description": o["criterion_description"],
            "examples": [
                {
                    "task": e["task_key"],
                    "remark": e.get("text", ""),
                    "outcome": e.get("outcome", ""),
                }
                for e in o["evidence"]
            ],
            "limitations": o["limitations"],
        }
        for o in observations
    ]
    try:
        rows = await ai.summarize_observations(context)
    except Exception:
        return {}, "AI не ответил корректно: наблюдения сформированы правилами"
    prefix = observations[0]["observation_id"].rsplit(":", 2)[0]
    return {f"{prefix}:{k}": v for k, v in rows.items()}, "Формулировки подготовлены AI"


@router.post("/hr/work-evidence/{eid}/analyze")
async def analyze(eid: str, account=Depends(hr_account), session: Session = Depends(get_session)):
    if not session.get(Document, f"employee:{eid}"):
        raise HTTPException(404, "Сотрудник не найден")
    artifacts, tasks, criteria, _ = work_context(session, eid)
    observations, insufficient = analyze_rules(eid, artifacts, tasks, criteria)
    wording, message = await ai_wording(session, observations)
    created = kept = 0
    for obs in observations:
        if obs["observation_id"] in wording:
            obs["summary"] = wording[obs["observation_id"]]["summary"]
            obs["alternative"] = wording[obs["observation_id"]]["alternative"]
            obs["summary_mode"] = "ai"
        doc = session.get(Document, obs["observation_id"])
        if doc and doc.payload["fingerprint"] == obs["fingerprint"]:
            kept += 1  # Same evidence: keep status, comments and the expert decision.
            continue
        previous = doc.payload if doc else {}
        payload = {
            **obs,
            "status": "draft",
            "comments": previous.get("comments", []),
            "review": None,
            "previous_reviews": previous.get("previous_reviews", [])
            + ([previous["review"]] if previous.get("review") else []),
            "analyzed_at": now(),
            "analyzed_by": account.username,
        }
        if doc:
            doc.payload = payload
            session.add(doc)
        else:
            session.add(Document(id=obs["observation_id"], kind="observation", payload=payload))
        created += 1
    session.add(Audit(actor=account.username, action="work_evidence_analyzed", target=eid))
    session.commit()
    return {
        "observations": len(observations),
        "updated": created,
        "unchanged": kept,
        "insufficient": len(insufficient),
        "message": message,
    }


def observations_for(session, eid):
    return sorted(
        (o for o in load(session, "observation") if o["employee_id"] == eid),
        key=lambda o: (o["kind"] != "development", o["criterion_title"]),
    )


def confirmed_focus(session, eid):
    """Skills with an expert-confirmed development area. Levels are not modified."""
    return {
        o["skill_id"]
        for o in observations_for(session, eid)
        if o["kind"] == "development" and o["status"] == "confirmed"
    }


def own_or_hr(eid, account):
    if account.role != "hr" and account.employee_id != eid:
        raise HTTPException(403, "Можно просматривать только свои рабочие примеры")


@router.get("/employees/{eid}/work-evidence")
def work_evidence(
    eid: str, account=Depends(current_account), session: Session = Depends(get_session)
):
    own_or_hr(eid, account)
    employee_doc = session.get(Document, f"employee:{eid}")
    if not employee_doc:
        raise HTTPException(404, "Сотрудник не найден")
    employee = employee_doc.payload
    artifacts, tasks, criteria, unmatched = work_context(session, eid)
    _, insufficient = analyze_rules(eid, artifacts, tasks, criteria)
    observations = observations_for(session, eid)
    skills, events, history = bundle(session)
    as_of = skills["meta"]["as_of_date"]
    history = [r for r in history if r["employee_id"] == eid]
    levels = current_skills(employee, history, events, as_of)
    names = {s["skill_id"]: s["name"] for s in skills["skills"]}
    gaps = {
        g["skill_id"]: g
        for g in gap_rows(
            employee, levels, skills["role_profiles"], {s["skill_id"]: s for s in skills["skills"]}
        )
    }
    focus = []
    for o in observations:
        if o["kind"] != "development" or o["status"] != "confirmed":
            continue
        sid = o["skill_id"]
        covering = [
            e["title"]
            for e in events.values()
            if eligible(employee, levels, e, history, as_of)
            and apply_gains(levels, e).get(sid, 0) > levels.get(sid, 0)
        ]
        gap = gaps.get(sid)
        if not gap:
            note = "Навык не входит в требования текущей цели. Приоритет рекомендаций не меняется."
        elif not gap["gap"]:
            note = "По последней оценке требование цели выполнено. Наблюдение — повод обсудить переоценку, курс не подбирается."
        elif covering:
            note = "Мероприятия, развивающие этот навык, получают повышенный приоритет в рекомендациях."
        else:
            note = "В каталоге нет доступного мероприятия для этого навыка: пробел каталога. Обсудите практику или наставничество — курс не придумывается."
        focus.append(
            {"skill_id": sid, "name": names.get(sid, sid), "note": note, "courses": covering[:3]}
        )
    worklog = {}
    for t in tasks.values():
        for w in t["worklogs"]:
            worklog[w["kind"]] = worklog.get(w["kind"], 0) + w["hours"]
    return {
        "artifacts": [
            {
                k: a[k]
                for k in (
                    "artifact_id",
                    "source",
                    "kind",
                    "title",
                    "url",
                    "version",
                    "created_at",
                    "task_id",
                    "contribution",
                    "shared",
                )
            }
            | {"findings": len(a["findings"]), "task_key": tasks.get(a["task_id"], {}).get("key")}
            for a in sorted(artifacts, key=lambda a: a["created_at"], reverse=True)
        ],
        "tasks": [
            {
                "task_id": t["task_id"],
                "key": t["key"],
                "title": t["title"],
                "estimate_hours": t["estimate_hours"],
                "logged_hours": sum(w["hours"] for w in t["worklogs"] if w["kind"] != "blocked"),
                "blocked_hours": sum(w["hours"] for w in t["worklogs"] if w["kind"] == "blocked"),
                "acceptance_criteria": t["acceptance_criteria"],
            }
            for t in sorted(tasks.values(), key=lambda t: t["key"])
        ],
        "worklog_by_kind": worklog,
        "observations": observations,
        "insufficient": insufficient,
        "focus": focus,
        "unmatched_artifacts": unmatched if account.role == "hr" else None,
        "skill_names": {
            o["skill_id"]: names.get(o["skill_id"], o["skill_id"]) for o in observations
        },
    }


def observation_doc(session, oid, lock=False):
    query = select(Document).where(Document.id == oid, Document.kind == "observation")
    doc = session.exec(query.with_for_update() if lock else query).first()
    if not doc:
        raise HTTPException(404, "Наблюдение не найдено")
    return doc


@router.post("/employees/{eid}/observations/{oid}/comments", status_code=201)
def comment(
    eid: str,
    oid: str,
    body: ObservationComment,
    account=Depends(current_account),
    session: Session = Depends(get_session),
):
    own_or_hr(eid, account)
    doc = observation_doc(session, oid, lock=True)
    if doc.payload["employee_id"] != eid:
        raise HTTPException(404, "Наблюдение не найдено")
    entry = {"author": account.username, "role": account.role, "text": body.text, "at": now()}
    doc.payload = {**doc.payload, "comments": doc.payload["comments"] + [entry]}
    session.add(doc)
    session.add(Audit(actor=account.username, action="observation_commented", target=oid))
    session.commit()
    return entry


@router.post("/hr/observations/{oid}/review")
def review_observation(
    oid: str,
    body: ObservationReview,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    doc = observation_doc(session, oid, lock=True)
    status = doc.payload["status"]
    if status != "draft":
        if status == body.decision:
            return doc.payload
        raise HTTPException(409, "Наблюдение уже рассмотрено")
    doc.payload = {
        **doc.payload,
        "status": body.decision,
        "review": {
            "decision": body.decision,
            "note": body.note,
            "reviewer": account.username,
            "at": now(),
            "fingerprint": doc.payload["fingerprint"],
        },
    }
    session.add(doc)
    session.add(Audit(actor=account.username, action=f"observation_{body.decision}", target=oid))
    session.commit()
    return doc.payload


@router.get("/hr/work-evidence/queue")
def queue(account=Depends(hr_account), session: Session = Depends(get_session)):
    names = {e["employee_id"]: e["full_name"] for e in load(session, "employee")}
    drafts = [o for o in load(session, "observation") if o["status"] == "draft"]
    return {
        "drafts": [
            {
                "observation_id": o["observation_id"],
                "employee_id": o["employee_id"],
                "full_name": names.get(o["employee_id"], o["employee_id"]),
                "criterion_title": o["criterion_title"],
                "kind": o["kind"],
                "task_keys": o["task_keys"],
            }
            for o in sorted(drafts, key=lambda o: o["observation_id"])
        ],
        "artifacts": len(load(session, "work_artifact")),
    }
