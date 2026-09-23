import json

import httpx
import pytest
from app import connectors, evidence
from app.config import settings
from conftest import sign_in

PULLS = [
    {
        "number": 1,
        "title": "PAY-1 transfer limits",
        "user": {"login": "alice", "type": "User"},
        "head": {"ref": "feature/limits", "sha": "abc1234def"},
        "body": "Adds limits endpoint",
        "html_url": "https://github.com/acme/pay/pull/1",
        "created_at": "2026-09-01T10:00:00Z",
    },
    {
        "number": 2,
        "title": "Partner webhook",
        "user": {"login": "alice", "type": "User"},
        "head": {"ref": "webhook", "sha": "fff0000aaa"},
        "body": None,
        "html_url": "https://github.com/acme/pay/pull/2",
        "created_at": "2026-09-05T10:00:00Z",
    },
    {
        "number": 3,
        "title": "Bump deps",
        "user": {"login": "dependabot[bot]", "type": "Bot"},
        "head": {"ref": "deps", "sha": "123"},
        "body": "",
        "html_url": "https://github.com/acme/pay/pull/3",
        "created_at": "2026-09-06T10:00:00Z",
    },
]
REVIEWS = {
    1: [
        {"id": 11, "body": "Нет проверки владельца счёта", "user": {"login": "bob"}},
        {"id": 12, "body": "", "user": {"login": "bob"}},
        {"id": 13, "body": "self note", "user": {"login": "alice"}},
    ],
    2: [{"id": 14, "body": "Webhook принимается без подписи", "user": {"login": "carol"}}],
}
COMMENTS = {
    1: [
        {"id": 21, "body": "Опечатка в имени переменной", "user": {"login": "bob"}},
        {"id": 22, "in_reply_to_id": 21, "body": "reply", "user": {"login": "carol"}},
    ],
    2: [],
}
ADF = {
    "type": "doc",
    "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Acceptance criteria"}]},
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "Own accounts only"}],
                        }
                    ],
                }
            ],
        },
    ],
}


def handler(request):
    path, host = request.url.path, request.url.host
    if host == "api.github.com":
        if path == "/repos/acme/pay":
            return httpx.Response(200, json={"full_name": "acme/pay"})
        if path == "/repos/acme/limited":
            return httpx.Response(403, headers={"x-ratelimit-remaining": "0"}, json={})
        if path == "/repos/acme/pay/pulls":
            return httpx.Response(200, json=PULLS)
        for n in (1, 2, 3):
            if path == f"/repos/acme/pay/pulls/{n}/reviews":
                return httpx.Response(200, json=REVIEWS.get(n, []))
            if path == f"/repos/acme/pay/pulls/{n}/comments":
                return httpx.Response(200, json=COMMENTS.get(n, []))
        return httpx.Response(404, json={})
    if host == "acme.atlassian.net":
        if request.headers.get("authorization") is None:
            return httpx.Response(401)
        if path == "/rest/api/3/project/PAY":
            return httpx.Response(200, json={"name": "Payments"})
        if path == "/rest/api/3/search/jql":
            assert request.url.params["jql"] == 'project = "PAY" ORDER BY updated DESC'
            issue = {
                "key": "PAY-1",
                "fields": {
                    "summary": "Transfer limits",
                    "assignee": {"accountId": "acc-1", "displayName": "Demo Employee"},
                    "timeoriginalestimate": 28800,
                    "description": ADF,
                    "status": {"name": "Done"},
                },
            }
            return httpx.Response(200, json={"issues": [issue]})
        if path == "/rest/api/3/issue/PAY-1/worklog":
            log = {
                "started": "2026-09-02T09:00:00.000+0000",
                "timeSpentSeconds": 7200,
                "author": {"accountId": "acc-1"},
            }
            return httpx.Response(200, json={"worklogs": [log]})
        if path == "/wiki/api/v2/spaces":
            return httpx.Response(200, json={"results": [{"id": "100", "name": "Product"}]})
        if path == "/wiki/api/v2/spaces/100/pages":
            page = {
                "id": "5",
                "title": "PRD for PAY-2",
                "authorId": "acc-2",
                "createdAt": "2026-09-03T10:00:00Z",
                "version": {"number": 3},
                "body": {"storage": {"value": "<p>Problem &amp; metric</p>"}},
                "_links": {"webui": "/spaces/P/pages/5"},
            }
            return httpx.Response(200, json={"results": [page]})
        if path == "/wiki/api/v2/pages/5/footer-comments":
            comment = {
                "id": "c1",
                "version": {"authorId": "acc-3", "createdAt": "2026-09-04T10:00:00Z"},
                "body": {"storage": {"value": "<p>Нет сценария отказа</p>"}},
            }
            return httpx.Response(200, json={"results": [comment]})
        if path == "/wiki/api/v2/pages/5/inline-comments":
            return httpx.Response(200, json={"results": []})
        if path == "/wiki/rest/api/user":
            return httpx.Response(200, json={"displayName": "Zhanna"})
    return httpx.Response(404, json={})


@pytest.fixture(autouse=True)
def fake_network(monkeypatch):
    monkeypatch.setattr(connectors, "transport", httpx.MockTransport(handler))


CRITERIA = {
    "meta": {"synthetic": True},
    "criteria": [
        {
            "criterion_id": "C_SYS",
            "roles": ["Backend Engineer"],
            "skill_id": "SK_SYSTEM",
            "title": "Design and access checks",
            "description": "Synthetic criterion",
        }
    ],
    "identities": [],
    "tasks": [],
    "artifacts": [],
}
GITHUB = {"source": "github", "scope": "acme/pay", "token": "ghp_secret_token_1234"}
JIRA = {
    "source": "jira",
    "scope": "PAY",
    "site_url": "https://acme.atlassian.net",
    "email": "hr@example.invalid",
    "token": "atlassian-token-9876",
}
CONFLUENCE = {**JIRA, "source": "confluence", "scope": "PROD"}


def hr(client):
    sign_in(client, "hr")
    body = json.dumps(CRITERIA).encode()
    assert (
        client.post("/api/hr/work-evidence/import", files={"file": ("c.json", body)}).status_code
        == 200
    )


def connect(client, body):
    response = client.post("/api/hr/connections", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def sync(client, cid):
    response = client.post(f"/api/hr/connections/{cid}/sync")
    assert response.status_code == 200, response.text
    return response.json()


def test_only_hr_manages_integrations(client):
    sign_in(client)
    assert client.get("/api/hr/connections").status_code == 403
    assert client.post("/api/hr/connections", json=GITHUB).status_code == 403
    assert client.get("/api/hr/findings").status_code == 403
    assert (
        client.post(
            "/api/hr/identities", json={"source": "github", "external_id": "x", "employee_id": "E1"}
        ).status_code
        == 403
    )
    status = client.get("/api/hr/integrations/status")
    assert status.status_code == 200 and "token" not in status.text


@pytest.mark.parametrize(
    "body",
    [
        {**JIRA, "site_url": "https://evil.example.com"},
        {**JIRA, "site_url": "http://acme.atlassian.net"},
        {**JIRA, "token": ""},
        {**GITHUB, "scope": "../../etc"},
        {**JIRA, "scope": "pay; drop"},
    ],
)
def test_connection_input_is_restricted(client, body):
    sign_in(client, "hr")
    assert client.post("/api/hr/connections", json=body).status_code == 422
    assert client.get("/api/hr/connections").json()["connections"] == []


def test_connection_is_checked_and_token_never_returned(client):
    sign_in(client, "hr")
    bad = client.post("/api/hr/connections", json={**GITHUB, "scope": "acme/missing"})
    assert bad.status_code == 422 and "Не найдено" in bad.json()["detail"]
    limited = client.post("/api/hr/connections", json={**GITHUB, "scope": "acme/limited"})
    assert "Лимит" in limited.json()["detail"]
    created = connect(client, GITHUB)
    assert created["has_token"] and created["token_hint"] == "…1234"
    listed = client.get("/api/hr/connections").text
    assert "ghp_secret" not in listed and "ghp_secret" not in json.dumps(created)
    assert client.post("/api/hr/connections", json=GITHUB).status_code == 409
    assert client.delete(f"/api/hr/connections/{created['connection_id']}").status_code == 200
    assert client.get("/api/hr/connections").json()["connections"] == []


def test_github_sync_label_and_analyze(client):
    hr(client)
    cid = connect(client, GITHUB)["connection_id"]
    result = sync(client, cid)
    assert (
        result["artifacts"] == 2 and result["findings"] == 3
    )  # bot PR, empty, self and replies skipped
    ids = client.get("/api/hr/identities").json()
    assert {"github", "alice"} <= {
        x for u in ids["unmatched"] for x in (u["source"], u["external_id"])
    }
    pending = client.get("/api/hr/findings").json()["pending"]
    assert len(pending) == 3 and all(p["employee_id"] is None for p in pending)
    assert (
        client.post(
            "/api/hr/identities",
            json={"source": "github", "external_id": "alice", "employee_id": "NOPE"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/hr/identities",
            json={"source": "github", "external_id": "alice", "employee_id": "E1"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/hr/identities",
            json={"source": "github", "external_id": "alice", "employee_id": "E2"},
        ).status_code
        == 409
    )
    # Unlabelled live remarks never reach the analysis.
    assert client.post("/api/hr/work-evidence/E1/analyze").json()["observations"] == 0
    pending = {p["finding_id"]: p for p in client.get("/api/hr/findings").json()["pending"]}
    assert pending["gh-review-11"]["full_name"] == "Demo Employee"
    for fid, artifact, criterion in [
        ("gh-review-11", "github:acme/pay#1", "C_SYS"),
        ("gh-review-14", "github:acme/pay#2", "C_SYS"),
        ("gh-comment-21", "github:acme/pay#1", None),
    ]:
        response = client.post(
            "/api/hr/findings/label",
            json={"artifact_id": artifact, "finding_id": fid, "criterion_id": criterion},
        )
        assert response.status_code == 200, response.text
    assert (
        client.post(
            "/api/hr/findings/label",
            json={
                "artifact_id": "github:acme/pay#1",
                "finding_id": "gh-review-11",
                "criterion_id": "NOPE",
            },
        ).status_code
        == 422
    )
    assert client.get("/api/hr/findings").json()["pending"] == []
    analysis = client.post("/api/hr/work-evidence/E1/analyze").json()
    assert analysis["observations"] == 1
    data = client.get("/api/employees/E1/work-evidence").json()
    obs = data["observations"][0]
    assert obs["task_keys"] == ["PAY-1", "pay#2"]
    assert "подключённых систем" in obs["limitations"][0]
    assert {e["finding_id"] for e in obs["evidence"]} == {"gh-review-11", "gh-review-14"}
    assert {a["artifact_id"] for a in data["artifacts"]} == {
        "github:acme/pay#1",
        "github:acme/pay#2",
    }
    # Re-sync is idempotent and keeps HR labels.
    sync(client, cid)
    assert client.get("/api/hr/findings").json()["pending"] == []
    assert client.post("/api/hr/work-evidence/E1/analyze").json()["unchanged"] == 1


def test_jira_replaces_placeholder_and_maps_assignee(client):
    hr(client)
    github = connect(client, GITHUB)["connection_id"]
    sync(client, github)
    jira = sync(client, connect(client, JIRA)["connection_id"])
    assert jira["tasks"] == 1
    client.post(
        "/api/hr/identities", json={"source": "jira", "external_id": "acc-1", "employee_id": "E1"}
    )
    tasks = {t["key"]: t for t in client.get("/api/employees/E1/work-evidence").json()["tasks"]}
    assert tasks["PAY-1"]["title"] == "Transfer limits"
    assert tasks["PAY-1"]["estimate_hours"] == 8 and tasks["PAY-1"]["logged_hours"] == 2
    assert tasks["PAY-1"]["acceptance_criteria"] == ["Own accounts only"]
    names = {
        u["external_id"]: u["display_name"]
        for u in client.get("/api/hr/identities").json()["mapped"]
    }
    assert names["acc-1"] == "Demo Employee"
    # A later GitHub sync must not overwrite the real Jira task with a placeholder.
    sync(client, github)
    tasks = {t["key"]: t for t in client.get("/api/employees/E1/work-evidence").json()["tasks"]}
    assert tasks["PAY-1"]["title"] == "Transfer limits"


def test_confluence_comments_and_shared_atlassian_identity(client):
    hr(client)
    result = sync(client, connect(client, CONFLUENCE)["connection_id"])
    assert result == {**result, "artifacts": 1, "findings": 1}
    unmatched = {u["external_id"]: u for u in client.get("/api/hr/identities").json()["unmatched"]}
    assert unmatched["acc-2"]["display_name"] == "Zhanna"
    # One Atlassian account: mapping it via Jira also applies to Confluence pages.
    client.post(
        "/api/hr/identities", json={"source": "jira", "external_id": "acc-2", "employee_id": "E2"}
    )
    pending = client.get("/api/hr/findings").json()["pending"]
    assert pending[0]["employee_id"] == "E2" and pending[0]["text"] == "Нет сценария отказа"
    assert "acc-2" not in {
        u["external_id"] for u in client.get("/api/hr/identities").json()["unmatched"]
    }


def test_failed_sync_is_reported(client, monkeypatch):
    hr(client)
    cid = connect(client, GITHUB)["connection_id"]
    monkeypatch.setattr(connectors, "transport", httpx.MockTransport(lambda r: httpx.Response(401)))
    response = client.post(f"/api/hr/connections/{cid}/sync")
    assert response.status_code == 502 and "токен" in response.json()["detail"]
    last = client.get("/api/hr/connections").json()["connections"][0]["last_sync"]
    assert last["ok"] is False


def test_ai_suggestions_need_confirmation(client, monkeypatch):
    hr(client)
    sync(client, connect(client, GITHUB)["connection_id"])
    assert "вручную" in client.post("/api/hr/findings/suggest").json()["message"]
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    sent = {}

    async def fake(items, criteria):
        sent["payload"] = json.dumps({"items": items, "criteria": criteria}, ensure_ascii=False)
        return {
            i["id"]: {
                "criterion_id": "C_SYS" if "провер" in i["text"] else None,
                "reason": "Synthetic reason",
            }
            for i in items
        }

    monkeypatch.setattr(connectors.ai, "suggest_criteria", fake)
    assert client.post("/api/hr/findings/suggest").json()["suggested"] == 3
    for leak in ("alice", "bob", "github.com", "acme"):
        assert leak not in sent["payload"]
    pending = {p["finding_id"]: p for p in client.get("/api/hr/findings").json()["pending"]}
    assert pending["gh-review-11"]["suggested_criterion"] == "C_SYS"
    assert pending["gh-comment-21"]["suggested_criterion"] == "none"
    # A suggestion alone is not a label: nothing is analysed yet.
    client.post(
        "/api/hr/identities", json={"source": "github", "external_id": "alice", "employee_id": "E1"}
    )
    assert client.post("/api/hr/work-evidence/E1/analyze").json()["observations"] == 0

    async def broken(items, criteria):
        raise ValueError("unknown criterion")

    monkeypatch.setattr(connectors.ai, "suggest_criteria", broken)
    client.post(
        "/api/hr/findings/label",
        json={
            "artifact_id": "github:acme/pay#1",
            "finding_id": "gh-review-11",
            "criterion_id": None,
        },
    )
    assert client.post("/api/hr/findings/suggest").json()["suggested"] == 0


def test_default_criteria_match_demo_file():
    from pathlib import Path

    demo = json.loads(
        (Path(__file__).parents[2] / "demo" / "work_evidence_synthetic.json").read_text()
    )
    defaults = {c["criterion_id"]: c for c in connectors.DEFAULT_CRITERIA}
    for criterion in demo["criteria"]:
        assert defaults[criterion["criterion_id"]] == criterion


def test_adf_and_acceptance_parsing():
    text = connectors.adf_text(ADF)
    assert connectors.acceptance_criteria(text) == ["Own accounts only"]
    assert connectors.acceptance_criteria("Нет раздела") == []
    assert evidence.usable({"criterion_id": "C", "label_status": "pending"}) is False
