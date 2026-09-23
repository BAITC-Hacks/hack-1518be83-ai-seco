import copy
import json

import pytest
from app.db import get_session
from app.models import Account, Completion, Document
from conftest import sign_in


def configure_manager(client, scope=True):
    provider = client.app.dependency_overrides[get_session]()
    with next(provider) as session:
        employee = session.get(Account, "employee")
        session.add(
            Account(
                username="manager",
                role="manager",
                employee_id="E1",
                password_hash=employee.password_hash,
            )
        )
        e2 = session.get(Document, "employee:E2")
        e2.payload = {**e2.payload, "department": "Other Department"}
        session.add(e2)
        e1 = session.get(Document, "employee:E1").payload
        session.add(
            Document(
                id="employee:E3",
                kind="employee",
                payload={**copy.deepcopy(e1), "employee_id": "E3", "full_name": "Team Member"},
            )
        )
        if scope:
            session.add(
                Document(
                    id="manager_scope:manager",
                    kind="manager_scope",
                    payload={"department": "Engineering"},
                )
            )
        session.commit()
    provider.close()


def plan(**changes):
    return {
        "status": "active",
        "owner": "hr",
        "next_review_on": "2026-10-20",
        "note": "Synthetic agreed development plan.",
        "revision": 0,
        **changes,
    }


def test_manager_only_reads_assigned_department(client):
    configure_manager(client)
    sign_in(client, "manager")
    overview = client.get("/api/team/overview")
    assert overview.status_code == 200
    data = overview.json()
    assert data["department"] == "Engineering"
    assert {r["employee_id"] for r in data["employees"]} == {"E1", "E3"}
    assert data["departments"] == ["Engineering"] and data["hr_owners"] == []
    assert data["pending"] == []
    assert client.get("/api/employees/E3").status_code == 200
    assert client.get("/api/employees/E2").status_code == 403
    assert client.post("/api/employees/E2/ai-explanation").status_code == 403
    assert client.get("/api/hr/overview").status_code == 403


def test_manager_without_scope_fails_closed(client):
    configure_manager(client, scope=False)
    sign_in(client, "manager")
    assert client.get("/api/team/overview").status_code == 403
    assert client.get("/api/employees/E1").status_code == 403


def test_manager_does_not_receive_private_assessment_or_completion_evidence(client):
    configure_manager(client)
    provider = client.app.dependency_overrides[get_session]()
    with next(provider) as session:
        session.add(
            Document(
                id="onboarding:E3",
                kind="onboarding",
                payload={"status": "assessed", "assessment_id": "assessment:private"},
            )
        )
        session.add(
            Document(
                id="assessment:private",
                kind="assessment",
                payload={"note": "Private synthetic assessment evidence"},
            )
        )
        session.add(
            Completion(
                employee_id="E3",
                event_id="EV_001",
                occurrence="once",
                completed_at="2026-09-25",
                evidence="Private synthetic completion evidence",
            )
        )
        session.commit()
    provider.close()
    sign_in(client, "manager")
    response = client.get("/api/employees/E3")
    assert response.status_code == 200
    assert response.json()["assessment"] is None
    assert response.json()["completions"] == []
    assert "Private synthetic" not in response.text
    sign_in(client, "hr")
    data = client.get("/api/employees/E3").json()
    assert data["assessment"]["note"] == "Private synthetic assessment evidence"
    assert data["completions"][0]["evidence"] == "Private synthetic completion evidence"


@pytest.mark.parametrize("username", ["employee", "manager"])
def test_hr_writes_cannot_be_done_by_other_roles(client, username):
    configure_manager(client)
    sign_in(client, username)
    assert client.put("/api/hr/employees/E1/development-plan", json=plan()).status_code == 403
    assert (
        client.put(
            "/api/hr/employees/E1/grade-period",
            json={"grade_since": "2024-01-01", "note": "Synthetic grade record"},
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/hr/support-policy",
            json={
                "inactivity_days": 90,
                "grade_months": 18,
                "misses": 3,
            },
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/employees/E1/goal",
            json={
                "target_role": "Backend Engineer",
                "target_grade": "Senior",
            },
        ).status_code
        == 403
    )
    if username == "manager":
        assert (
            client.post(
                "/api/employees/E3/completions",
                json={
                    "event_id": "EV_001",
                    "completed_at": "2026-09-25",
                    "evidence": "Synthetic completion evidence",
                },
            ).status_code
            == 403
        )
        assert client.get("/api/hr/work-evidence/queue").status_code == 403


def test_employee_cannot_read_overview_or_other_plans(client):
    sign_in(client)
    assert client.get("/api/team/overview").status_code == 403
    assert client.get("/api/employees/E2").status_code == 403


def test_plan_persists_and_rejects_lost_updates(client):
    sign_in(client, "hr")
    response = client.put("/api/hr/employees/E1/development-plan", json=plan())
    assert response.status_code == 200
    assert response.json()["revision"] == 1
    assert (
        client.put(
            "/api/hr/employees/E1/development-plan", json=plan(note="Stale update")
        ).status_code
        == 409
    )
    sign_in(client)
    stored = client.get("/api/employees/E1").json()["development_plan"]
    assert stored["note"] == plan()["note"] and stored["updated_by"] == "hr"


@pytest.mark.parametrize(
    "change",
    [
        {"next_review_on": None},
        {"next_review_on": "2026-09-01"},
        {"owner": "employee"},
        {"owner": "absent"},
        {"status": "unknown"},
        {"note": "x"},
    ],
)
def test_invalid_plan_is_not_saved(client, change):
    sign_in(client, "hr")
    assert (
        client.put("/api/hr/employees/E1/development-plan", json=plan(**change)).status_code == 422
    )
    assert client.get("/api/employees/E1").json()["development_plan"] is None


def test_pause_suppresses_inactivity_until_review_but_does_not_change_skills(client):
    sign_in(client, "hr")
    before = client.get("/api/employees/E1").json()
    assert (
        client.put("/api/hr/employees/E1/development-plan", json=plan(status="paused")).status_code
        == 200
    )
    row = next(
        r for r in client.get("/api/hr/overview").json()["employees"] if r["employee_id"] == "E1"
    )
    assert row["paused"] is True and row["priority"] == "planned"
    assert not any("Нет записей" in s for s in row["signals"])
    assert client.get("/api/employees/E1").json()["levels"] == before["levels"]
    assert (
        client.put(
            "/api/hr/employees/E1/development-plan",
            json=plan(status="paused", revision=1, next_review_on="2026-10-01"),
        ).status_code
        == 200
    )
    row = next(
        r for r in client.get("/api/hr/overview").json()["employees"] if r["employee_id"] == "E1"
    )
    assert row["priority"] == "high"
    assert any("дата следующего" in s for s in row["signals"])


def test_grade_date_can_be_recorded_for_imported_profile_without_reassessment(client):
    sign_in(client, "hr")
    before = client.get("/api/employees/E1").json()
    assert before["grade_since"] is None
    request = {"grade_since": "2024-01-01", "note": "Synthetic grade confirmation", "revision": 0}
    assert client.put("/api/hr/employees/E1/grade-period", json=request).status_code == 200
    after = client.get("/api/employees/E1").json()
    assert after["grade_months"] == 33 and after["onboarding"] is None
    assert after["employee"] == before["employee"] and after["levels"] == before["levels"]
    assert after["grade_record"]["history"][0]["reviewer"] == "hr"
    assert client.put("/api/hr/employees/E1/grade-period", json=request).status_code == 409
    assert (
        client.put(
            "/api/hr/employees/E1/grade-period",
            json={**request, "revision": 1, "grade_since": "2025-04-01"},
        ).status_code
        == 200
    )
    assert len(client.get("/api/employees/E1").json()["grade_record"]["history"]) == 2


@pytest.mark.parametrize("when", ["2023-12-31", "2026-10-02"])
def test_grade_date_bounds(client, when):
    sign_in(client, "hr")
    assert (
        client.put(
            "/api/hr/employees/E1/grade-period",
            json={"grade_since": when, "note": "Synthetic grade confirmation"},
        ).status_code
        == 422
    )


def test_support_policy_and_unknown_grade_date(client):
    sign_in(client, "hr")
    assert (
        client.put(
            "/api/hr/support-policy", json={"inactivity_days": 120, "grade_months": 24, "misses": 4}
        ).status_code
        == 200
    )
    overview = client.get("/api/hr/overview").json()
    assert overview["policy"]["inactivity_days"] == 120
    assert all(r["grade_months"] is None for r in overview["employees"])
    assert "120 дней" in json.dumps(overview, ensure_ascii=False)
    assert not any("мес. на текущем" in s for r in overview["employees"] for s in r["signals"])
    assert (
        client.put(
            "/api/hr/support-policy", json={"inactivity_days": 0, "grade_months": 24, "misses": 4}
        ).status_code
        == 422
    )
