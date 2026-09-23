import json

from conftest import sign_in


def test_imported_completion_during_pending_cannot_double_gain(client):
    sign_in(client)
    item = client.post(
        "/api/employees/E1/completions",
        json={
            "event_id": "EV_001",
            "completed_at": "2026-09-25",
            "evidence": "Synthetic completion evidence",
        },
    ).json()
    sign_in(client, "hr")
    csv = "record_id,employee_id,event_id,date,status,completion_pct,assigned_by\nR1,E1,EV_001,2026-09-25,completed,100,self\n"
    assert client.post("/api/hr/import", files={"history": ("h.csv", csv)}).status_code == 200
    assert (
        client.post(
            f"/api/hr/completions/{item['id']}/review",
            json={"decision": "approved", "note": "Checked"},
        ).status_code
        == 409
    )
    assert client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"] == 2


def test_approval_supersedes_enrollment_without_false_dropout(client):
    sign_in(client, "hr")
    csv = "record_id,employee_id,event_id,date,status,completion_pct,assigned_by\nR1,E1,EV_001,2026-09-20,in_progress,50,self\n"
    assert client.post("/api/hr/import", files={"history": ("h.csv", csv)}).status_code == 200
    sign_in(client)
    item = client.post(
        "/api/employees/E1/completions",
        json={
            "event_id": "EV_001",
            "completed_at": "2026-09-25",
            "evidence": "Synthetic completion evidence",
        },
    ).json()
    sign_in(client, "hr")
    assert (
        client.post(
            f"/api/hr/completions/{item['id']}/review",
            json={"decision": "approved", "note": "Checked"},
        ).status_code
        == 200
    )
    profile = client.get("/api/employees/E1").json()
    assert len(profile["history"]) == 1
    assert profile["history"][0]["status"] == "completed"
    assert client.post("/api/hr/import", files={"history": ("h.csv", csv)}).json()["inserted"] == 0


def test_invalid_json_shape_returns_validation_error(client):
    sign_in(client, "hr")
    for body in [{"employees": None}, {"employees": {}}, []]:
        assert (
            client.post(
                "/api/hr/import", files={"employees": ("e.json", json.dumps(body))}
            ).status_code
            == 422
        )


def test_hr_can_clear_employee_goal(client):
    sign_in(client, "hr")
    assert (
        client.put(
            "/api/employees/E1/goal", content="null", headers={"Content-Type": "application/json"}
        ).status_code
        == 200
    )
    profile = client.get("/api/employees/E1").json()
    assert profile["employee"]["career_goal"] is None and profile["recommendations"] == []
