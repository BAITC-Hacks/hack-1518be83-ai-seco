import json

from app.config import settings
from conftest import sign_in


def test_auth_and_employee_scope(client):
    assert client.get("/api/hr/overview").status_code == 401
    assert (
        client.post("/api/auth/login", json={"username": "hr", "password": "wrong"}).status_code
        == 401
    )
    sign_in(client)
    assert client.get("/api/employees/E1").status_code == 200
    assert client.get("/api/employees/E2").status_code == 403
    assert client.get("/api/hr/overview").status_code == 403
    assert client.put("/api/employees/E2/goal", json=None).status_code == 403
    assert (
        client.post(
            "/api/hr/completions/unknown/review",
            json={"decision": "approved", "note": "OK reviewed"},
        ).status_code
        == 403
    )
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/me").status_code == 401


def test_csrf_origin(client):
    assert (
        client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code
        == 403
    )


def test_goal_change_and_unknown_role(client):
    sign_in(client)
    assert (
        client.put(
            "/api/employees/E1/goal", json={"target_role": "Invented", "target_grade": "Lead"}
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/employees/E1/goal",
            json={"target_role": "Backend Engineer", "target_grade": "Lead"},
        ).status_code
        == 200
    )
    assert (
        client.get("/api/employees/E1").json()["employee"]["career_goal"]["target_grade"] == "Lead"
    )


def test_completion_requires_hr_and_is_idempotent(client):
    sign_in(client)
    before = client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"]
    body = {
        "event_id": "EV_001",
        "completed_at": "2026-09-25",
        "evidence": "Synthetic practice result confirmed",
    }
    response = client.post("/api/employees/E1/completions", json=body)
    assert response.status_code == 200, response.text
    cid = response.json()["id"]
    assert client.post("/api/employees/E1/completions", json=body).json()["id"] == cid
    assert client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"] == before
    sign_in(client, "hr")
    assert len(client.get("/api/hr/overview").json()["pending"]) == 1
    decision = {"decision": "approved", "note": "Practice checked"}
    assert client.post(f"/api/hr/completions/{cid}/review", json=decision).status_code == 200
    assert client.post(f"/api/hr/completions/{cid}/review", json=decision).status_code == 200
    profile = client.get("/api/employees/E1").json()
    assert profile["levels"]["SK_SYSTEM"] == before + 1
    assert len(profile["history"]) == 1
    assert profile["history"][0]["completed_at"] == body["completed_at"]
    assert profile["history"][0]["date"] == body["completed_at"]
    assert profile["history"][0]["source"] == "hr_confirmed"
    assert client.post("/api/employees/E1/completions", json=body).status_code == 409


def test_reject_does_not_change_skills(client):
    sign_in(client)
    cid = client.post(
        "/api/employees/E1/completions",
        json={
            "event_id": "EV_001",
            "completed_at": "2026-09-25",
            "evidence": "Practice without proof",
        },
    ).json()["id"]
    sign_in(client, "hr")
    assert (
        client.post(
            f"/api/hr/completions/{cid}/review",
            json={"decision": "rejected", "note": "Need a certificate"},
        ).status_code
        == 200
    )
    assert client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"] == 1


def test_completion_rejects_future_mandatory_and_pre_review(client):
    sign_in(client)
    for eid, when in [("EV_002", "2026-09-25"), ("EV_001", "2026-12-01"), ("EV_001", "2026-08-01")]:
        assert (
            client.post(
                "/api/employees/E1/completions",
                json={"event_id": eid, "completed_at": when, "evidence": "Synthetic evidence"},
            ).status_code
            == 422
        )


def test_import_valid_invalid_duplicate_atomicity(client, data):
    e, _, _ = data
    sign_in(client, "hr")
    new = {**e, "employee_id": "E3"}
    files = {"employees": ("employees.json", json.dumps({"employees": [new]}), "application/json")}
    response = client.post("/api/hr/import", files=files)
    assert response.status_code == 200, response.text
    assert response.json()["inserted"] == 1
    assert client.post("/api/hr/import", files=files).json()["inserted"] == 0
    invalid = {**e, "employee_id": "E4", "skills": {"SK_SYSTEM": 8}}
    assert (
        client.post(
            "/api/hr/import", files={"employees": ("e.json", json.dumps({"employees": [invalid]}))}
        ).status_code
        == 422
    )
    conflict = {**e, "full_name": "Changed"}
    assert (
        client.post(
            "/api/hr/import",
            files={
                "employees": (
                    "e.json",
                    json.dumps({"employees": [{**e, "employee_id": "E5"}, conflict]}),
                )
            },
        ).status_code
        == 409
    )
    assert client.get("/api/employees/E5").status_code == 404
    assert client.get("/api/employees/E1").json()["employee"]["full_name"] == e["full_name"]


def test_employee_cannot_import(client, data):
    sign_in(client)
    e, _, _ = data
    assert client.post("/api/hr/employees", json={**e, "employee_id": "E3"}).status_code == 403


def test_history_csv_import_and_bad_reference(client):
    sign_in(client, "hr")
    header = "record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\n"
    csv = header + "R1,E1,EV_001,2026-09-25,,completed,100,,,self\n"
    response = client.post(
        "/api/hr/import", files={"history": ("activity_history.csv", csv, "text/csv")}
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"] == 2
    bad = header + "R2,UNKNOWN,EV_001,2026-09-25,,completed,100,,,self\n"
    assert client.post("/api/hr/import", files={"history": ("history.csv", bad)}).status_code == 422


def test_ai_disabled_never_calls_provider(client, monkeypatch):
    sign_in(client)
    monkeypatch.setattr(settings, "ai_enabled", False)
    response = client.post("/api/employees/E1/ai-explanation")
    assert response.status_code == 200 and response.json()["mode"] == "rules"


def test_ai_mock_success_cache_limit_and_fallback(client, monkeypatch):
    from app import ai

    sign_in(client)
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "mock-not-a-key")
    monkeypatch.setattr(settings, "ai_daily_limit", 1)
    calls = []

    async def fake(context):
        calls.append(context)
        assert "full_name" not in json.dumps(context)
        return {e["event_id"]: "Synthetic explanation" for e in context["candidates"]}

    monkeypatch.setattr(ai, "explain", fake)
    first = client.post("/api/employees/E1/ai-explanation").json()
    assert first["mode"] == "ai" and not first["cached"]
    assert client.post("/api/employees/E1/ai-explanation").json()["cached"]
    assert len(calls) == 1
    client.put(
        "/api/employees/E1/goal", json={"target_role": "Backend Engineer", "target_grade": "Lead"}
    )
    assert client.post("/api/employees/E1/ai-explanation").json()["mode"] == "rules"


def test_ai_provider_failure_keeps_rules(client, monkeypatch):
    from app import ai

    sign_in(client)
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "mock-not-a-key")

    async def broken(context):
        raise TimeoutError("Do not leak internals")

    monkeypatch.setattr(ai, "explain", broken)
    response = client.post("/api/employees/E1/ai-explanation")
    assert response.json()["mode"] == "rules"
    assert "internals" not in response.text
