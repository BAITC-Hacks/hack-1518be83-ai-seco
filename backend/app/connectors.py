"""Live read-only connectors: GitHub, Jira Cloud and Confluence Cloud.

HR adds a connection, the server checks access and syncs on demand. Only what the analysis needs
is stored: titles, short excerpts, review remarks, worklogs. No diffs or source code.
Review remarks from live systems are unlabelled: AI may suggest a criterion, HR confirms it.
Only confirmed remarks reach the rule-based analysis in app.evidence.
"""

import copy
import hashlib
import html
import re
from datetime import UTC, datetime
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, model_validator
from sqlmodel import Session, select

from app import ai
from app.db import get_session
from app.evidence import Strict, identity_map, load, reserve_ai_call, resolve
from app.models import Audit, Document, now
from app.security import current_account, hr_account
from app.seed import bundle

router = APIRouter(prefix="/api/hr", tags=["Integrations"])

# Tests replace this with httpx.MockTransport; production uses the default network transport.
transport: httpx.BaseTransport | None = None

GITHUB_API = "https://api.github.com"
ATLASSIAN_SITE = re.compile(r"^https://[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$")
JIRA_KEY = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b")
SCOPES = {
    "github": re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$"),
    "jira": re.compile(r"^[A-Z][A-Z0-9_]{1,19}$"),
    "confluence": re.compile(r"^[A-Za-z0-9~_-]{1,64}$"),
}
TEXT_LIMIT = 600

# Default criteria per profession. HR confirms which one a live review remark belongs to.
# The first seven are identical to demo/work_evidence_synthetic.json.
DEFAULT_CRITERIA = [
    {
        "criterion_id": "BE_ACCESS_CHECKS",
        "roles": ["Backend Engineer"],
        "skill_id": "SK_APP_SECURITY",
        "title": "Проверки доступа и валидация входных данных",
        "description": "Эндпоинт проверяет владельца ресурса, подпись и границы параметров до выполнения операции.",
    },
    {
        "criterion_id": "BE_ERROR_CONTRACT",
        "roles": ["Backend Engineer"],
        "skill_id": "SK_API_DESIGN",
        "title": "Обработка ошибок и контракт API",
        "description": "Ошибки внешних сервисов, повторы и конфликты описаны в контракте и возвращают предсказуемые коды.",
    },
    {
        "criterion_id": "BE_OBSERVABILITY",
        "roles": ["Backend Engineer"],
        "skill_id": "SK_OBSERVABILITY",
        "title": "Логи, метрики и трассировка",
        "description": "По логам и метрикам можно восстановить путь запроса и причину сбоя.",
    },
    {
        "criterion_id": "BE_BOUNDARY_TESTS",
        "roles": ["Backend Engineer"],
        "skill_id": "SK_API_TESTING",
        "title": "Тесты граничных случаев",
        "description": "Автотесты покрывают граничные значения и негативные сценарии API.",
    },
    {
        "criterion_id": "PM_FAILURE_SCENARIOS",
        "roles": ["Product Manager"],
        "skill_id": "SK_REQUIREMENTS",
        "title": "Сценарии отказа в постановке",
        "description": "Постановка описывает поведение при недоступности зависимостей, ошибках и исключениях.",
    },
    {
        "criterion_id": "PM_ACCEPTANCE",
        "roles": ["Product Manager"],
        "skill_id": "SK_REQUIREMENTS",
        "title": "Проверяемые критерии приёмки",
        "description": "Критерии приёмки измеримы и однозначно проверяются тестом.",
    },
    {
        "criterion_id": "PM_PROBLEM_FRAMING",
        "roles": ["Product Manager"],
        "skill_id": "SK_PRODUCT_DISCOVERY",
        "title": "Формулировка проблемы и метрики успеха",
        "description": "Документ связывает проблему клиента, гипотезу и метрику успеха.",
    },
    {
        "criterion_id": "FE_UI_STATES",
        "roles": ["Frontend Engineer"],
        "skill_id": "SK_REACT",
        "title": "Состояния загрузки, ошибок и пустых данных",
        "description": "Компонент корректно показывает загрузку, ошибку и пустой результат.",
    },
    {
        "criterion_id": "FE_ACCESSIBILITY",
        "roles": ["Frontend Engineer"],
        "skill_id": "SK_ACCESSIBILITY",
        "title": "Доступность интерфейса",
        "description": "Элементы доступны с клавиатуры, имеют подписи и достаточный контраст.",
    },
    {
        "criterion_id": "QA_RISK_COVERAGE",
        "roles": ["QA Engineer"],
        "skill_id": "SK_TEST_DESIGN",
        "title": "Покрытие рисков и границ",
        "description": "Тест-кейсы покрывают риски, граничные значения и критерии приёмки.",
    },
    {
        "criterion_id": "DA_METRIC_CORRECTNESS",
        "roles": ["Data Analyst"],
        "skill_id": "SK_SQL",
        "title": "Корректность агрегаций и знаменателей",
        "description": "Запрос считает метрику на правильной выборке без дублей и потерь.",
    },
]


class ConnectorError(Exception):
    pass


class ConnectionIn(Strict):
    source: Literal["github", "jira", "confluence"]
    scope: str = Field(min_length=1, max_length=201)
    site_url: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=200)
    token: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def check(self):
        if not SCOPES[self.source].match(self.scope):
            raise ValueError(
                {
                    "github": "Репозиторий в формате owner/name",
                    "jira": "Ключ проекта Jira латиницей, например PAY",
                    "confluence": "Ключ пространства Confluence",
                }[self.source]
            )
        if self.source != "github":
            self.site_url = self.site_url.rstrip("/")
            # Only Atlassian Cloud hosts: the server never calls arbitrary URLs (SSRF).
            if not ATLASSIAN_SITE.match(self.site_url):
                raise ValueError("Адрес сайта Atlassian: https://<site>.atlassian.net")
            if not self.email or not self.token:
                raise ValueError("Для Atlassian нужны email и API-токен")
        return self


class IdentityIn(Strict):
    source: Literal["github", "jira", "confluence"]
    external_id: str = Field(min_length=1, max_length=128)
    employee_id: str


class LabelIn(Strict):
    artifact_id: str
    finding_id: str
    criterion_id: str | None = None  # None = "не относится к навыкам"
    outcome: Literal["open", "fixed"] = "open"


def ensure_criteria(session):
    skills, _, _ = bundle(session)
    known_skills = {s["skill_id"] for s in skills["skills"]}
    roles = {p["role"] for p in skills["role_profiles"]}
    added = 0
    for c in DEFAULT_CRITERIA:
        if c["skill_id"] not in known_skills or not set(c["roles"]) <= roles:
            continue
        if not session.get(Document, f"work_criterion:{c['criterion_id']}"):
            session.add(
                Document(id=f"work_criterion:{c['criterion_id']}", kind="work_criterion", payload=c)
            )
            added += 1
    return added


def client(conn):
    if conn["source"] == "github":
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if conn["token"]:
            headers["Authorization"] = f"Bearer {conn['token']}"
        return httpx.Client(base_url=GITHUB_API, headers=headers, timeout=10, transport=transport)
    return httpx.Client(
        base_url=conn["site_url"],
        auth=(conn["email"], conn["token"]),
        headers={"Accept": "application/json"},
        timeout=10,
        transport=transport,
    )


def get(http, path, params=None):
    try:
        response = http.get(path, params=params)
    except httpx.HTTPError as exc:
        raise ConnectorError("Сервис недоступен или не ответил за 10 секунд") from exc
    if response.status_code in {401, 403}:
        if response.headers.get("x-ratelimit-remaining") == "0":
            raise ConnectorError(
                "Лимит запросов GitHub исчерпан. Добавьте токен или повторите позже"
            )
        raise ConnectorError("Доступ отклонён: проверьте токен и права только на чтение")
    if response.status_code == 404:
        raise ConnectorError("Не найдено: проверьте репозиторий, проект или пространство")
    if response.status_code >= 400:
        raise ConnectorError(f"Сервис вернул ошибку {response.status_code}")
    return response.json()


def clip(text):
    return re.sub(r"\s+", " ", text or "").strip()[:TEXT_LIMIT]


def strip_markup(value):
    return clip(html.unescape(re.sub(r"<[^>]+>", " ", value or "")))


def adf_text(node):
    """Plain text from Jira's Atlassian Document Format, line per paragraph/list item."""
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text", "")
    parts = [adf_text(child) for child in node.get("content", [])]
    joiner = "\n" if node.get("type") in {"doc", "bulletList", "orderedList", "listItem"} else ""
    return joiner.join(p for p in parts if p)


def acceptance_criteria(text):
    lines = [line.strip(" -*•\t") for line in text.splitlines()]
    for i, line in enumerate(lines):
        if re.search(r"acceptance criteria|критери[ийя] приёмки|критери[ийя] приемки", line, re.I):
            return [clip(x) for x in lines[i + 1 : i + 11] if x][:10]
    return []


def day(value):
    return (value or "")[:10] or datetime.now(UTC).date().isoformat()


def finding(fid, reviewer, text, created):
    return {
        "finding_id": fid,
        "criterion_id": None,
        "suggested_criterion": None,
        "suggestion_reason": "",
        "label_status": "pending",
        "reviewer": reviewer,
        "text": text,
        "outcome": "open",
        "created_at": day(created),
    }


def note(accounts, external_id, name):
    """Remember an account and keep the first non-empty display name."""
    if name or external_id not in accounts:
        accounts[external_id] = name or accounts.get(external_id, "")


def placeholder_task(task_id, key, title, source):
    return {
        "task_id": task_id,
        "source": source,
        "key": key,
        "title": title[:200],
        "employee_id": None,
        "assignee_external_id": None,
        "acceptance_criteria": [],
        "estimate_hours": None,
        "worklogs": [],
        "placeholder": True,
    }


def fetch_github(conn):
    repo, limit = conn["scope"], 30 if conn["token"] else 12  # 60 req/h without a token
    artifacts, tasks, accounts = [], [], {}
    with client(conn) as http:
        pulls = get(
            http,
            f"/repos/{repo}/pulls",
            {"state": "all", "sort": "updated", "direction": "desc", "per_page": limit},
        )
        for pr in pulls[:limit]:
            if pr["user"].get("type") == "Bot":
                continue
            author, number = pr["user"]["login"], pr["number"]
            accounts[author] = author
            found = JIRA_KEY.search(
                f"{pr['title']} {pr['head'].get('ref', '')} {pr.get('body') or ''}"
            )
            if found:
                task_id = f"jira:{found.group(1)}"
                tasks.append(placeholder_task(task_id, found.group(1), pr["title"], "jira"))
            else:
                task_id = f"github:{repo}#{number}"
                tasks.append(
                    placeholder_task(
                        task_id, f"{repo.split('/')[1]}#{number}", pr["title"], "github"
                    )
                )
            remarks = []
            for review in get(http, f"/repos/{repo}/pulls/{number}/reviews", {"per_page": 50}):
                user = review.get("user") or {}
                if review.get("body") and user.get("login") != author and user.get("type") != "Bot":
                    remarks.append(
                        finding(
                            f"gh-review-{review['id']}",
                            user["login"],
                            clip(review["body"]),
                            review.get("submitted_at"),
                        )
                    )
            for comment in get(http, f"/repos/{repo}/pulls/{number}/comments", {"per_page": 100}):
                user = comment.get("user") or {}
                # Thread replies repeat the same point; only top-level remarks are evidence.
                if (
                    comment.get("in_reply_to_id")
                    or user.get("login") == author
                    or user.get("type") == "Bot"
                ):
                    continue
                remarks.append(
                    finding(
                        f"gh-comment-{comment['id']}",
                        user["login"],
                        clip(comment["body"]),
                        comment.get("created_at"),
                    )
                )
            artifacts.append(
                {
                    "artifact_id": f"github:{repo}#{number}",
                    "source": "github",
                    "kind": "pull_request",
                    "task_id": task_id,
                    "author_external_id": author,
                    "co_author_external_ids": [],
                    "title": clip(f"PR #{number} · {pr['title']}")[:200],
                    "url": pr["html_url"],
                    "version": (pr["head"].get("sha") or "")[:7],
                    "created_at": day(pr.get("created_at")),
                    "excerpt": clip(pr.get("body") or ""),
                    "findings": remarks,
                    "strengths": [],
                    "connection_id": conn["connection_id"],
                }
            )
    return artifacts, tasks, accounts


def fetch_jira(conn):
    tasks, accounts = [], {}
    with client(conn) as http:
        data = get(
            http,
            "/rest/api/3/search/jql",
            {
                "jql": f'project = "{conn["scope"]}" ORDER BY updated DESC',
                "maxResults": 30,
                "fields": "summary,assignee,timeoriginalestimate,description,status",
            },
        )
        for issue in data.get("issues", [])[:30]:
            fields, key = issue["fields"], issue["key"]
            assignee = fields.get("assignee") or {}
            if assignee.get("accountId"):
                note(accounts, assignee["accountId"], assignee.get("displayName"))
            worklogs = []
            for log in get(http, f"/rest/api/3/issue/{key}/worklog", {"maxResults": 100}).get(
                "worklogs", []
            ):
                author = log.get("author") or {}
                if author.get("accountId"):
                    note(accounts, author["accountId"], author.get("displayName"))
                hours = round(log.get("timeSpentSeconds", 0) / 3600, 2)
                if 0 < hours <= 24:
                    # Jira does not say what kind of work it was; never guess implementation vs review.
                    worklogs.append(
                        {"date": day(log.get("started")), "hours": hours, "kind": "unspecified"}
                    )
            text = adf_text(fields.get("description"))
            estimate = fields.get("timeoriginalestimate")
            tasks.append(
                {
                    "task_id": f"jira:{key}",
                    "source": "jira",
                    "key": key,
                    "title": clip(fields.get("summary"))[:200],
                    "employee_id": None,
                    "assignee_external_id": assignee.get("accountId"),
                    "acceptance_criteria": acceptance_criteria(text),
                    "estimate_hours": round(estimate / 3600, 1) if estimate else None,
                    "worklogs": worklogs,
                    "status": (fields.get("status") or {}).get("name", ""),
                    "url": f"{conn['site_url']}/browse/{key}",
                    "connection_id": conn["connection_id"],
                }
            )
    return [], tasks, accounts


def fetch_confluence(conn):
    artifacts, tasks, accounts = [], [], {}
    with client(conn) as http:
        spaces = get(http, "/wiki/api/v2/spaces", {"keys": conn["scope"]}).get("results", [])
        if not spaces:
            raise ConnectorError("Пространство Confluence не найдено")
        pages = get(
            http,
            f"/wiki/api/v2/spaces/{spaces[0]['id']}/pages",
            {"limit": 25, "body-format": "storage", "sort": "-modified-date"},
        ).get("results", [])
        for page in pages[:25]:
            author = page.get("authorId") or (page.get("version") or {}).get("authorId")
            body = strip_markup(((page.get("body") or {}).get("storage") or {}).get("value", ""))
            remarks = []
            for kind in ("footer-comments", "inline-comments"):
                comments = get(
                    http,
                    f"/wiki/api/v2/pages/{page['id']}/{kind}",
                    {"body-format": "storage", "limit": 50},
                ).get("results", [])
                for comment in comments:
                    who = (comment.get("version") or {}).get("authorId")
                    text = strip_markup(
                        ((comment.get("body") or {}).get("storage") or {}).get("value", "")
                    )
                    if who and who != author and text:
                        remarks.append(
                            finding(
                                f"cf-{comment['id']}",
                                who,
                                text,
                                (comment.get("version") or {}).get("createdAt"),
                            )
                        )
            found = JIRA_KEY.search(f"{page['title']} {body}")
            if found:
                task_id = f"jira:{found.group(1)}"
                tasks.append(placeholder_task(task_id, found.group(1), page["title"], "jira"))
            else:
                task_id = f"confluence:{page['id']}"
                tasks.append(
                    placeholder_task(
                        task_id, f"{conn['scope']}/{page['id']}", page["title"], "confluence"
                    )
                )
            if author:
                accounts.setdefault(author, "")
            artifacts.append(
                {
                    "artifact_id": f"confluence:{page['id']}",
                    "source": "confluence",
                    "kind": "page",
                    "task_id": task_id,
                    "author_external_id": author or "",
                    "co_author_external_ids": [],
                    "title": clip(page["title"])[:200],
                    "url": f"{conn['site_url']}/wiki{(page.get('_links') or {}).get('webui', '')}",
                    "version": f"v{(page.get('version') or {}).get('number', '?')}",
                    "created_at": day(page.get("createdAt")),
                    "excerpt": body[:TEXT_LIMIT],
                    "findings": remarks,
                    "strengths": [],
                    "connection_id": conn["connection_id"],
                }
            )
        # Confluence v2 returns only account IDs; resolve a few display names for HR.
        for account_id in [a for a, name in accounts.items() if not name][:20]:
            try:
                accounts[account_id] = get(
                    http, "/wiki/rest/api/user", {"accountId": account_id}
                ).get("displayName", "")
            except ConnectorError:
                pass
    return artifacts, tasks, accounts


FETCHERS = {"github": fetch_github, "jira": fetch_jira, "confluence": fetch_confluence}


def check_access(conn):
    with client(conn) as http:
        if conn["source"] == "github":
            repo = get(http, f"/repos/{conn['scope']}")
            return repo.get("full_name", conn["scope"])
        if conn["source"] == "jira":
            return get(http, f"/rest/api/3/project/{conn['scope']}").get("name", conn["scope"])
        spaces = get(http, "/wiki/api/v2/spaces", {"keys": conn["scope"]}).get("results", [])
        if not spaces:
            raise ConnectorError("Пространство Confluence не найдено")
        return spaces[0].get("name", conn["scope"])


def save_sync(session, artifacts, tasks):
    """Upsert synced items. Keeps HR labels on remarks; real Jira tasks replace placeholders."""
    counts = {"artifacts": 0, "tasks": 0, "findings": 0}
    for task in tasks:
        doc = session.get(Document, f"work_task:{task['task_id']}")
        if doc and task.get("placeholder"):
            continue  # Never overwrite a real or already known task with a placeholder.
        if doc:
            doc.payload = task
            session.add(doc)
        else:
            session.add(Document(id=f"work_task:{task['task_id']}", kind="work_task", payload=task))
        counts["tasks"] += 1
    for artifact in artifacts:
        doc = session.get(Document, f"work_artifact:{artifact['artifact_id']}")
        previous = {f["finding_id"]: f for f in (doc.payload["findings"] if doc else [])}
        for f in artifact["findings"]:
            old = previous.get(f["finding_id"])
            if old:
                for key in (
                    "criterion_id",
                    "suggested_criterion",
                    "suggestion_reason",
                    "label_status",
                    "outcome",
                ):
                    f[key] = old.get(key, f[key])
        counts["findings"] += len(artifact["findings"])
        if doc:
            doc.payload = artifact
            session.add(doc)
        else:
            session.add(
                Document(
                    id=f"work_artifact:{artifact['artifact_id']}",
                    kind="work_artifact",
                    payload=artifact,
                )
            )
        counts["artifacts"] += 1
    return counts


def public(conn):
    return {
        "connection_id": conn["connection_id"],
        "source": conn["source"],
        "scope": conn["scope"],
        "site_url": conn["site_url"],
        "name": conn.get("name", conn["scope"]),
        "email": conn["email"],
        "has_token": bool(conn["token"]),
        "token_hint": f"…{conn['token'][-4:]}" if len(conn["token"]) > 8 else "",
        "created_at": conn["created_at"],
        "created_by": conn["created_by"],
        "last_sync": conn.get("last_sync"),
    }


def connection_doc(session, cid):
    doc = session.get(Document, cid)
    if not doc or doc.kind != "connection":
        raise HTTPException(404, "Подключение не найдено")
    return doc


@router.get("/connections")
def list_connections(account=Depends(hr_account), session: Session = Depends(get_session)):
    return {"connections": [public(c) for c in load(session, "connection")]}


@router.post("/connections", status_code=201)
def add_connection(
    body: ConnectionIn, account=Depends(hr_account), session: Session = Depends(get_session)
):
    # URL-safe id: scopes such as owner/repo contain slashes.
    digest = hashlib.sha256(f"{body.source}:{body.scope.lower()}".encode()).hexdigest()[:12]
    cid = f"connection-{body.source}-{digest}"
    if session.get(Document, cid):
        raise HTTPException(409, "Такое подключение уже есть")
    conn = {
        **body.model_dump(),
        "connection_id": cid,
        "created_at": now(),
        "created_by": account.username,
    }
    try:
        conn["name"] = check_access(conn)
    except ConnectorError as exc:
        raise HTTPException(422, f"Подключение не сохранено: {exc}") from exc
    ensure_criteria(session)
    session.add(Document(id=cid, kind="connection", payload=conn))
    session.add(Audit(actor=account.username, action="connection_added", target=cid))
    session.commit()
    return public(conn)


@router.delete("/connections/{cid}")
def delete_connection(
    cid: str, account=Depends(hr_account), session: Session = Depends(get_session)
):
    doc = connection_doc(session, cid)
    session.delete(doc)  # The token is removed with the connection; synced items stay for audit.
    session.add(Audit(actor=account.username, action="connection_removed", target=cid))
    session.commit()
    return {"ok": True}


@router.post("/connections/{cid}/sync")
def sync_connection(cid: str, account=Depends(hr_account), session: Session = Depends(get_session)):
    doc = connection_doc(session, cid)
    conn = doc.payload
    started = datetime.now(UTC)
    try:
        artifacts, tasks, accounts = FETCHERS[conn["source"]](conn)
    except ConnectorError as exc:
        doc.payload = {**conn, "last_sync": {"at": now(), "ok": False, "error": str(exc)}}
        session.add(doc)
        session.commit()
        raise HTTPException(502, f"Синхронизация не выполнена: {exc}") from exc
    ensure_criteria(session)
    counts = save_sync(session, artifacts, tasks)
    known = {
        **conn.get("accounts", {}),
        **{k: v for k, v in accounts.items() if v or k not in conn.get("accounts", {})},
    }
    doc.payload = {
        **conn,
        "accounts": known,
        "last_sync": {
            "at": now(),
            "ok": True,
            "seconds": round((datetime.now(UTC) - started).total_seconds(), 1),
            **counts,
        },
    }
    session.add(doc)
    session.add(Audit(actor=account.username, action="connection_synced", target=cid))
    session.commit()
    return doc.payload["last_sync"]


@router.get("/identities")
def identities(account=Depends(hr_account), session: Session = Depends(get_session)):
    mapped = identity_map(session)
    names = {e["employee_id"]: e["full_name"] for e in load(session, "employee")}
    display = {}
    for c in load(session, "connection"):
        for ext, name in c.get("accounts", {}).items():
            display[(c["source"], ext)] = name
    seen = {}
    for a in load(session, "work_artifact"):
        for ext in [a["author_external_id"], *a["co_author_external_ids"]]:
            if ext:
                seen.setdefault((a["source"], ext), 0)
                seen[(a["source"], ext)] += 1
    for t in load(session, "work_task"):
        if t.get("assignee_external_id"):
            seen.setdefault(("jira", t["assignee_external_id"]), 0)
            seen[("jira", t["assignee_external_id"])] += 1
    unmatched = [
        {"source": s, "external_id": e, "display_name": display.get((s, e), ""), "items": n}
        for (s, e), n in sorted(seen.items())
        if resolve(mapped, s, e) is None
    ]
    return {
        "mapped": [
            {
                "source": s,
                "external_id": e,
                "employee_id": eid,
                "full_name": names.get(eid, eid),
                "display_name": display.get((s, e), ""),
            }
            for (s, e), eid in sorted(mapped.items())
        ],
        "unmatched": unmatched,
    }


@router.post("/identities", status_code=201)
def add_identity(
    body: IdentityIn, account=Depends(hr_account), session: Session = Depends(get_session)
):
    if not session.get(Document, f"employee:{body.employee_id}"):
        raise HTTPException(422, "Сотрудник с таким ID не найден")
    ident = f"work_identity:{body.source}:{body.external_id}"
    existing = session.get(Document, ident)
    if existing:
        if existing.payload["employee_id"] == body.employee_id:
            return existing.payload
        raise HTTPException(
            409, "Аккаунт уже привязан к другому сотруднику. Сначала удалите привязку"
        )
    payload = {**body.model_dump(), "confirmed_by": account.username, "confirmed_at": now()}
    session.add(Document(id=ident, kind="work_identity", payload=payload))
    session.add(
        Audit(
            actor=account.username,
            action="identity_mapped",
            target=f"{body.source}:{body.external_id}",
        )
    )
    session.commit()
    return payload


@router.delete("/identities/{source}/{external_id}")
def delete_identity(
    source: str,
    external_id: str,
    account=Depends(hr_account),
    session: Session = Depends(get_session),
):
    doc = session.get(Document, f"work_identity:{source}:{external_id}")
    if not doc:
        raise HTTPException(404, "Привязка не найдена")
    session.delete(doc)
    session.add(
        Audit(actor=account.username, action="identity_removed", target=f"{source}:{external_id}")
    )
    session.commit()
    return {"ok": True}


def pending_items(session, limit=200):
    mapped = identity_map(session)
    names = {e["employee_id"]: e["full_name"] for e in load(session, "employee")}
    rows = []
    for a in sorted(load(session, "work_artifact"), key=lambda a: a["created_at"], reverse=True):
        owner = resolve(mapped, a["source"], a["author_external_id"])
        for f in a["findings"]:
            if f.get("label_status") != "pending":
                continue
            rows.append(
                {
                    "artifact_id": a["artifact_id"],
                    "artifact_title": a["title"],
                    "url": a["url"],
                    "source": a["source"],
                    "author": a["author_external_id"],
                    "employee_id": owner,
                    "full_name": names.get(owner) if owner else None,
                    "finding_id": f["finding_id"],
                    "reviewer": f["reviewer"],
                    "text": f["text"],
                    "suggested_criterion": f.get("suggested_criterion"),
                    "suggestion_reason": f.get("suggestion_reason", ""),
                }
            )
    return rows[:limit]


@router.get("/findings")
def findings(account=Depends(hr_account), session: Session = Depends(get_session)):
    ensure_criteria(session)
    session.commit()
    return {
        "pending": pending_items(session),
        "criteria": sorted(
            load(session, "work_criterion"), key=lambda c: (c["roles"][0], c["title"])
        ),
    }


@router.post("/findings/suggest")
async def suggest(account=Depends(hr_account), session: Session = Depends(get_session)):
    from app.config import settings

    ensure_criteria(session)
    session.commit()
    rows = [r for r in pending_items(session) if not r["suggested_criterion"]][:25]
    if not rows:
        return {"suggested": 0, "message": "Нет замечаний без подсказки"}
    if not settings.ai_enabled or not settings.openai_api_key:
        return {"suggested": 0, "message": "AI не подключён: выберите критерий вручную"}
    if not reserve_ai_call(session):
        return {"suggested": 0, "message": "Дневной лимит AI-запросов исчерпан"}
    criteria = load(session, "work_criterion")
    # Only the remark text and criteria are sent: no names, logins, repositories or links.
    items = [{"id": f"r{i}", "text": r["text"]} for i, r in enumerate(rows)]
    catalog = [{k: c[k] for k in ("criterion_id", "title", "description")} for c in criteria]
    try:
        answers = await ai.suggest_criteria(items, catalog)
    except Exception:
        return {"suggested": 0, "message": "AI не ответил корректно: выберите критерий вручную"}
    updated = 0
    for i, r in enumerate(rows):
        answer = answers.get(f"r{i}")
        if not answer:
            continue
        doc = session.exec(
            select(Document)
            .where(Document.id == f"work_artifact:{r['artifact_id']}")
            .with_for_update()
        ).first()
        payload = copy.deepcopy(doc.payload)
        for f in payload["findings"]:
            if f["finding_id"] == r["finding_id"] and f.get("label_status") == "pending":
                f["suggested_criterion"] = answer["criterion_id"] or "none"
                f["suggestion_reason"] = answer["reason"]
                updated += 1
        doc.payload = payload
        session.add(doc)
    session.add(Audit(actor=account.username, action="findings_suggested", target=str(updated)))
    session.commit()
    return {"suggested": updated, "message": "Подсказки AI готовы. Каждую нужно подтвердить"}


@router.post("/findings/label")
def label(body: LabelIn, account=Depends(hr_account), session: Session = Depends(get_session)):
    doc = session.exec(
        select(Document).where(Document.id == f"work_artifact:{body.artifact_id}").with_for_update()
    ).first()
    if not doc:
        raise HTTPException(404, "Материал не найден")
    if body.criterion_id and not session.get(Document, f"work_criterion:{body.criterion_id}"):
        raise HTTPException(422, "Неизвестный критерий")
    payload = copy.deepcopy(doc.payload)  # JSON columns detect changes only on a new value.
    items = payload["findings"]
    target = next((f for f in items if f["finding_id"] == body.finding_id), None)
    if not target or "label_status" not in target:
        raise HTTPException(404, "Замечание не найдено или размечено при импорте")
    target.update(
        criterion_id=body.criterion_id,
        label_status="labeled" if body.criterion_id else "dismissed",
        outcome=body.outcome,
        labeled_by=account.username,
        labeled_at=now(),
    )
    doc.payload = payload
    session.add(doc)
    session.add(Audit(actor=account.username, action="finding_labeled", target=body.finding_id))
    session.commit()
    return target


@router.get("/integrations/status")
def status(account=Depends(current_account), session: Session = Depends(get_session)):
    """Non-secret summary for any signed-in user: what is connected, never tokens or data."""
    return {
        "connections": [
            {
                "source": c["source"],
                "name": c.get("name", c["scope"]),
                "last_sync": (c.get("last_sync") or {}).get("at"),
            }
            for c in load(session, "connection")
        ]
    }
