import json

from conftest import sign_in
from test_catalog import add_expert
from test_team import configure_manager


def body(level=3, when="2026-09-20", skill="SK_SYSTEM"):
    return {
        "assessed_on": when,
        "method": "practical_task",
        "ratings": [
            {"skill_id": skill, "level": level, "evidence": "Designed a service on review"}
        ],
        "note": "Synthetic repeat assessment.",
    }


def expert(client):
    client.post("/api/auth/login", json={"username": "expert", "password": "test-password"})


def test_confirmed_reassessment_becomes_baseline_without_touching_the_profile(client, data):
    employee, _, _ = data
    add_expert(client)
    sign_in(client, "hr")
    csv = "record_id,employee_id,event_id,date,status,completion_pct,assigned_by\nR1,E1,EV_001,2026-09-10,completed,100,self\n"
    client.post("/api/hr/import", files={"history": ("h.csv", csv)})
    assert client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"] == 2
    proposed = client.post("/api/hr/employees/E1/reassessments", json=body()).json()
    assert proposed["before"] == {"SK_SYSTEM": 2} and proposed["status"] == "proposed"
    rid = proposed["reassessment_id"]
    decision = {"decision": "confirmed", "note": "Checked result"}
    assert client.post(f"/api/hr/reassessments/{rid}/decision", json=decision).status_code == 403
    assert client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"] == 2
    expert(client)
    assert (
        client.post(f"/api/hr/reassessments/{rid}/decision", json=decision).json()["status"]
        == "confirmed"
    )
    profile = client.get("/api/employees/E1").json()
    # New baseline 3; the September completion is inside it and not added a second time.
    assert profile["levels"]["SK_SYSTEM"] == 3 and profile["levels"]["SK_SPEAK"] == 0
    assert profile["employee"]["last_review_date"] == "2026-09-20"
    # The stored profile is untouched: re-importing the original is still a no-op.
    files = {"employees": ("e.json", json.dumps({"employees": [employee]}))}
    assert client.post("/api/hr/import", files=files).json()["inserted"] == 0
    history = client.get("/api/employees/E1/reassessments").json()
    assert history[0]["comparison"][0] | {"evidence": None} == {
        "skill_id": "SK_SYSTEM",
        "name": "System Design",
        "before": 2,
        "after": 3,
        "delta": 1,
        "evidence": None,
    }


def test_completion_before_new_baseline_is_rejected(client):
    add_expert(client)
    sign_in(client, "hr")
    rid = client.post("/api/hr/employees/E1/reassessments", json=body()).json()["reassessment_id"]
    expert(client)
    client.post(
        f"/api/hr/reassessments/{rid}/decision", json={"decision": "confirmed", "note": "Checked"}
    )
    sign_in(client)
    early = {"event_id": "EV_001", "completed_at": "2026-09-15", "evidence": "Synthetic evidence"}
    assert client.post("/api/employees/E1/completions", json=early).status_code == 422


def test_rules_dates_and_single_open_proposal(client):
    add_expert(client)
    sign_in(client)
    assert client.post("/api/hr/employees/E1/reassessments", json=body()).status_code == 403
    sign_in(client, "hr")
    assert (
        client.post("/api/hr/employees/E1/reassessments", json=body(when="2026-08-01")).status_code
        == 422
    )
    assert (
        client.post("/api/hr/employees/E1/reassessments", json=body(when="2026-10-02")).status_code
        == 422
    )
    assert (
        client.post("/api/hr/employees/E1/reassessments", json=body(skill="SK_X")).status_code
        == 422
    )
    rid = client.post("/api/hr/employees/E1/reassessments", json=body()).json()["reassessment_id"]
    assert client.post("/api/hr/employees/E1/reassessments", json=body()).status_code == 409
    expert(client)
    rejected = client.post(
        f"/api/hr/reassessments/{rid}/decision", json={"decision": "rejected", "note": "No proof"}
    )
    assert rejected.json()["status"] == "rejected"
    assert client.get("/api/employees/E1").json()["levels"]["SK_SYSTEM"] == 1


def test_privacy_of_assessment_grounds(client):
    add_expert(client)
    sign_in(client, "hr")
    client.post("/api/hr/employees/E1/reassessments", json=body())
    sign_in(client)
    own = client.get("/api/employees/E1/reassessments").json()
    assert own[0]["comparison"][0]["evidence"] and own[0]["note"]
    assert client.get("/api/employees/E2/reassessments").status_code == 403
    configure_manager(client)
    sign_in(client, "manager")
    seen = client.get("/api/employees/E1/reassessments").json()
    assert seen[0]["comparison"][0]["evidence"] is None and "note" not in seen[0]
