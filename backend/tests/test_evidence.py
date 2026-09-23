import copy
import json

import pytest
from app import evidence
from app.config import settings
from conftest import sign_in


def finding(fid, criterion="C_SYS", outcome="open"):
    return {
        "finding_id": fid,
        "criterion_id": criterion,
        "reviewer": "reviewer",
        "text": f"Synthetic remark {fid}",
        "outcome": outcome,
    }


def artifact(aid, task, author="u1", findings=(), strengths=(), co=()):
    return {
        "artifact_id": aid,
        "source": "github",
        "kind": "pull_request",
        "task_id": task,
        "author_external_id": author,
        "co_author_external_ids": list(co),
        "title": f"PR {aid}",
        "url": f"https://git.example.invalid/{aid}",
        "version": "abc123",
        "created_at": "2026-09-10",
        "excerpt": "synthetic diff",
        "findings": list(findings),
        "strengths": list(strengths),
    }


def task(tid, eid="E1", blocked=0):
    logs = [{"date": "2026-09-10", "hours": 4, "kind": "implementation"}]
    if blocked:
        logs.append({"date": "2026-09-11", "hours": blocked, "kind": "blocked"})
    return {
        "task_id": tid,
        "source": "jira",
        "key": tid.replace("T", "KEY-"),
        "title": f"Task {tid}",
        "employee_id": eid,
        "acceptance_criteria": [],
        "estimate_hours": 8,
        "worklogs": logs,
    }


@pytest.fixture
def work():
    return {
        "meta": {"synthetic": True},
        "criteria": [
            {
                "criterion_id": "C_SYS",
                "roles": ["Backend Engineer"],
                "skill_id": "SK_SYSTEM",
                "title": "Design rationale",
                "description": "Synthetic criterion",
            },
            {
                "criterion_id": "C_SPEAK",
                "roles": ["Backend Engineer"],
                "skill_id": "SK_SPEAK",
                "title": "Demo clarity",
                "description": "Synthetic criterion",
            },
        ],
        "identities": [
            {"source": "github", "external_id": "u1", "employee_id": "E1", "confirmed_by": "hr"},
            {"source": "github", "external_id": "u2", "employee_id": "E2", "confirmed_by": "hr"},
        ],
        "tasks": [task("T1", blocked=6), task("T2"), task("T3"), task("T4", "E2")],
        "artifacts": [
            # Two remarks in one task are one independent example.
            artifact("A1", "T1", findings=[finding("F1"), finding("F2")], strengths=["C_SPEAK"]),
            artifact("A2", "T2", findings=[finding("F3", outcome="fixed")]),
            # Excluded: context showed the remark does not apply.
            artifact("A3", "T3", findings=[finding("F4", outcome="not_applicable")]),
            # Unknown author is not guessed and not analysed.
            artifact("A4", "T4", author="stranger", findings=[finding("F5")]),
        ],
    }


def upload(client, payload):
    body = json.dumps(payload).encode()
    return client.post(
        "/api/hr/work-evidence/import",
        files={"file": ("work.json", body, "application/json")},
    )


def prepared(client, work):
    sign_in(client, "hr")
    assert upload(client, work).status_code == 200
    response = client.post("/api/hr/work-evidence/E1/analyze")
    assert response.status_code == 200, response.text
    return response.json()


def test_only_hr_imports_analyzes_and_reviews(client, work):
    sign_in(client)
    assert upload(client, work).status_code == 403
    assert client.post("/api/hr/work-evidence/E1/analyze").status_code == 403
    assert (
        client.post(
            "/api/hr/observations/obs:E1:C_SYS:development/review",
            json={"decision": "confirmed", "note": "ok"},
        ).status_code
        == 403
    )
    assert client.get("/api/hr/work-evidence/queue").status_code == 403


@pytest.mark.parametrize(
    "mutate",
    [
        lambda w: w["meta"].update(synthetic=False),
        lambda w: w["criteria"][0].update(skill_id="SK_UNKNOWN"),
        lambda w: w["identities"][0].update(employee_id="NOPE"),
        lambda w: w["artifacts"][0].update(task_id="T404"),
        lambda w: w["artifacts"][1]["findings"][0].update(finding_id="F1"),
    ],
)
def test_invalid_bundle_is_rejected(client, work, mutate):
    sign_in(client, "hr")
    mutate(work)
    assert upload(client, work).status_code == 422
    assert client.get("/api/employees/E1/work-evidence").json()["artifacts"] == []


def test_import_is_idempotent_and_never_overwrites(client, work):
    sign_in(client, "hr")
    assert upload(client, work).json()["inserted"] == 12
    assert upload(client, work).json()["inserted"] == 0
    changed = copy.deepcopy(work)
    changed["artifacts"][0]["title"] = "Rewritten"
    changed["tasks"].append(task("T9"))
    assert upload(client, changed).status_code == 409
    tasks = client.get("/api/employees/E1/work-evidence").json()["tasks"]
    assert "KEY-9" not in {t["key"] for t in tasks}


def test_rules_need_independent_tasks(client, work):
    result = prepared(client, work)
    assert result["observations"] == 1 and result["insufficient"] == 1
    data = client.get("/api/employees/E1/work-evidence").json()
    (obs,) = data["observations"]
    assert obs["observation_id"] == "obs:E1:C_SYS:development"
    assert obs["task_keys"] == ["KEY-1", "KEY-2"]
    assert obs["status"] == "draft" and obs["summary_mode"] == "rules"
    assert any("не считаются недостатком" in x for x in obs["limitations"])
    assert data["insufficient"][0]["criterion_id"] == "C_SPEAK"
    assert data["unmatched_artifacts"] == 1
    assert {a["artifact_id"] for a in data["artifacts"]} == {"A1", "A2", "A3"}


def test_employee_scope_and_comments(client, work):
    prepared(client, work)
    client.post("/api/auth/logout")
    sign_in(client)
    data = client.get("/api/employees/E1/work-evidence").json()
    assert data["unmatched_artifacts"] is None
    assert client.get("/api/employees/E2/work-evidence").status_code == 403
    oid = data["observations"][0]["observation_id"]
    url = f"/api/employees/E1/observations/{oid}/comments"
    assert client.post(url, json={"text": "Context: design was fixed upstream"}).status_code == 201
    assert (
        client.post(
            f"/api/employees/E2/observations/{oid}/comments", json={"text": "hijack"}
        ).status_code
        == 403
    )
    comments = client.get("/api/employees/E1/work-evidence").json()["observations"][0]["comments"]
    assert comments[0]["role"] == "employee"


def test_confirmation_raises_priority_without_changing_levels(client, work):
    before = None
    sign_in(client, "hr")
    before = client.get("/api/employees/E1").json()
    prepared(client, work)
    draft = client.get("/api/employees/E1").json()
    assert draft["recommendations"] == before["recommendations"]
    oid = "obs:E1:C_SYS:development"
    url = f"/api/hr/observations/{oid}/review"
    assert (
        client.post(url, json={"decision": "confirmed", "note": "Checked PRs"}).status_code == 200
    )
    assert client.post(url, json={"decision": "confirmed", "note": "Again"}).status_code == 200
    assert client.post(url, json={"decision": "rejected", "note": "Changed"}).status_code == 409
    after = client.get("/api/employees/E1").json()
    assert after["levels"] == before["levels"]
    rec = next(r for r in after["recommendations"] if r["event_id"] == "EV_001")
    old = next(r for r in before["recommendations"] if r["event_id"] == "EV_001")
    assert rec["score"] == pytest.approx(old["score"] * 2)
    assert rec["benefits"][0]["evidence"] is True
    assert "рабочим примерам" in rec["reason"]
    focus = client.get("/api/employees/E1/work-evidence").json()["focus"]
    assert focus[0]["courses"] == ["System Design Lab"]
    # Same evidence on re-analysis keeps the expert decision.
    assert client.post("/api/hr/work-evidence/E1/analyze").json()["unchanged"] == 1
    obs = client.get("/api/employees/E1/work-evidence").json()["observations"][0]
    assert obs["status"] == "confirmed"


def test_rejected_observation_has_no_effect(client, work):
    sign_in(client, "hr")
    before = client.get("/api/employees/E1").json()["recommendations"]
    prepared(client, work)
    client.post(
        "/api/hr/observations/obs:E1:C_SYS:development/review",
        json={"decision": "rejected", "note": "Remarks were subjective"},
    )
    assert client.get("/api/employees/E1").json()["recommendations"] == before
    assert client.get("/api/hr/work-evidence/queue").json()["drafts"] == []


def test_ai_wording_and_fallback(client, work, monkeypatch):
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    sent = {}

    async def fake(context):
        sent["context"] = context
        return {
            c["observation_id"]: {
                "summary": "AI summary of repeated synthetic remarks",
                "alternative": "Maybe the design was agreed elsewhere",
            }
            for c in context
        }

    monkeypatch.setattr(evidence.ai, "summarize_observations", fake)
    result = prepared(client, work)
    assert result["message"] == "Формулировки подготовлены AI"
    assert "E1" not in json.dumps(sent["context"])
    obs = client.get("/api/employees/E1/work-evidence").json()["observations"][0]
    assert obs["summary_mode"] == "ai" and obs["alternative"]

    async def broken(context):
        raise ValueError("bad ids")

    monkeypatch.setattr(evidence.ai, "summarize_observations", broken)
    client.post("/api/hr/work-evidence/E1/analyze")
    obs = client.get("/api/employees/E1/work-evidence").json()["observations"][0]
    assert obs["summary_mode"] == "ai"  # unchanged evidence keeps the saved observation


def test_ai_failure_falls_back_to_rules(client, work, monkeypatch):
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    async def broken(context):
        raise TimeoutError

    monkeypatch.setattr(evidence.ai, "summarize_observations", broken)
    result = prepared(client, work)
    assert "правилами" in result["message"]
    obs = client.get("/api/employees/E1/work-evidence").json()["observations"][0]
    assert obs["summary_mode"] == "rules"


def test_synthetic_demo_file_is_valid():
    from pathlib import Path

    raw = json.loads(
        (Path(__file__).parents[2] / "demo" / "work_evidence_synthetic.json").read_text()
    )
    parsed = evidence.EvidenceBundle.model_validate(raw)
    assert parsed.meta["synthetic"] is True
