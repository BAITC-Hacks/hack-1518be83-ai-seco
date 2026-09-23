import json

import pytest
from app.db import get_session
from app.models import Account, Audit, Document
from app.onboarding import elapsed_months
from app.security import password_hash
from conftest import sign_in
from sqlmodel import select


def employee(**overrides):
    return {
        "employee_id": "NEW1",
        "full_name": "Synthetic New Employee",
        "department": "Engineering",
        "role": "Backend Engineer",
        "grade": "Middle",
        "specialization": "Java / Spring",
        "hire_date": "2025-01-15",
        "grade_since": "2026-03-01",
        "manager_id": "E2",
        "work_format": "remote",
        "preferred_language": "kk",
        "create_account": False,
        **overrides,
    }


def assessment(**overrides):
    return {
        "assessed_on": "2026-09-20",
        "method": "practical_task",
        "ratings": [
            {"skill_id": "SK_SYSTEM", "level": 1, "evidence": "Synthetic system design exercise"},
            {"skill_id": "SK_SPEAK", "level": 0, "evidence": "Synthetic speaking assessment"},
        ],
        "note": "Synthetic baseline, reviewed by HR after practice.",
        **overrides,
    }


def create(client, **overrides):
    sign_in(client, "hr")
    response = client.post("/api/hr/onboarding", json=employee(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_hr_onboarding_assessment_goal_recommendations(client):
    created = create(client)
    assert created == {"employee_id": "NEW1", "access": None}
    before = client.get("/api/employees/NEW1").json()
    assert before["employee"]["skills"] == {}
    assert before["employee"]["hire_date"] == "2025-01-15"
    assert before["employee"]["department"] == "Engineering"
    assert before["employee"]["work_format"] == "remote"
    assert before["employee"]["preferred_language"] == "kk"
    assert before["onboarding"]["status"] == "pending_assessment"
    assert before["onboarding"]["specialization"] == "Java / Spring"
    assert before["grade_since"] == "2026-03-01" and before["grade_months"] == 7
    assert before["recommendations"] == [] and before["readiness"] is None
    target = {"target_role": "Backend Engineer", "target_grade": "Senior"}
    assert client.put("/api/employees/NEW1/goal", json=target).status_code == 409
    assert (
        client.post(
            "/api/employees/NEW1/completions",
            json={
                "event_id": "EV_001",
                "completed_at": "2026-09-25",
                "evidence": "Synthetic proof",
            },
        ).status_code
        == 409
    )
    response = client.post("/api/hr/employees/NEW1/initial-assessment", json=assessment())
    assert response.status_code == 201, response.text
    reviewed = client.get("/api/employees/NEW1").json()
    assert reviewed["levels"] == {"SK_SYSTEM": 1, "SK_SPEAK": 0}
    assert reviewed["employee"]["last_review_date"] == "2026-09-20"
    assert reviewed["assessment"]["reviewer"] == "hr"
    assert reviewed["assessment"]["ratings"] == assessment()["ratings"]
    assert reviewed["recommendations"] == []
    assert client.put("/api/employees/NEW1/goal", json=target).status_code == 200
    ready = client.get("/api/employees/NEW1").json()
    assert {r["event_id"] for r in ready["recommendations"]} == {"EV_001", "EV_036"}
    assert ready["readiness"] is not None
    assert ready["employee"]["role"] == "Backend Engineer"
    assert ready["employee"]["grade"] == "Middle"
    # Repeated first assessment cannot rewrite the baseline.
    assert (
        client.post("/api/hr/employees/NEW1/initial-assessment", json=assessment()).status_code
        == 409
    )
    assert client.get("/api/employees/NEW1").json()["levels"] == ready["levels"]


def test_generated_account_scoped_and_password_not_stored_or_returned(client):
    created = create(client, create_account=True)
    access = created["access"]
    response = client.post("/api/auth/login", json=access)
    assert response.status_code == 200
    assert response.json()["role"] == "employee"
    assert response.json()["employee_id"] == "NEW1"
    profile = client.get("/api/employees/NEW1")
    assert profile.status_code == 200 and access["password"] not in profile.text
    assert client.get("/api/employees/E1").status_code == 403
    assert client.get("/api/hr/overview").status_code == 403
    assert client.post("/api/hr/onboarding", json=employee(employee_id="NEW2")).status_code == 403
    assert (
        client.post("/api/hr/employees/NEW1/initial-assessment", json=assessment()).status_code
        == 403
    )
    assert client.put("/api/employees/NEW1/goal", json=None).status_code == 403
    with next(client.app.dependency_overrides[get_session]()) as session:
        stored = session.get(Account, access["username"])
        assert stored.password_hash != access["password"]
        assert password_hash.verify(access["password"], stored.password_hash)
        for doc in session.exec(select(Document)).all():
            assert access["password"] not in json.dumps(doc.payload)
        for event in session.exec(select(Audit)).all():
            assert access["password"] not in event.model_dump_json()


def test_partial_assessment_keeps_unknown_separate_from_zero(client):
    create(client, grade_since=None)
    response = client.post(
        "/api/hr/employees/NEW1/initial-assessment",
        json=assessment(
            ratings=[{"skill_id": "SK_SYSTEM", "level": 0, "evidence": "Synthetic zero baseline"}]
        ),
    )
    assert response.status_code == 201
    assert (
        client.put(
            "/api/employees/NEW1/goal",
            json={"target_role": "Backend Engineer", "target_grade": "Senior"},
        ).status_code
        == 200
    )
    profile = client.get("/api/employees/NEW1").json()
    gaps = {g["skill_id"]: g for g in profile["gaps"]}
    assert gaps["SK_SYSTEM"]["assessed"] and gaps["SK_SYSTEM"]["current"] == 0
    assert not gaps["SK_SPEAK"]["assessed"]
    assert profile["readiness"] is None and profile["grade_months"] is None
    assert [r["event_id"] for r in profile["recommendations"]] == ["EV_001"]
    overview = client.get("/api/hr/overview").json()
    row = next(e for e in overview["employees"] if e["employee_id"] == "NEW1")
    assert row["readiness"] is None
    speaking = next(g for g in overview["gaps"] if g["name"] == "Public Speaking")
    assert speaking["count"] == 2  # Two imported employees, not the unassessed new profile.


def test_hr_cannot_overwrite_imported_assessment(client):
    sign_in(client, "hr")
    before = client.get("/api/employees/E1").json()
    assert (
        client.post("/api/hr/employees/E1/initial-assessment", json=assessment()).status_code == 409
    )
    assert client.get("/api/employees/E1").json()["levels"] == before["levels"]


@pytest.mark.parametrize(
    "changes",
    [
        {"hire_date": "2026-10-02"},
        {"grade_since": "2024-01-01"},
        {"grade_since": "2026-10-02"},
        {"role": "Unknown"},
        {"manager_id": "Unknown"},
        {"full_name": "   "},
        {"career_goal": {"target_role": "Backend Engineer", "target_grade": "Senior"}},
        {"skills": {"SK_SYSTEM": 5}},
    ],
)
def test_invalid_onboarding_is_atomic(client, changes):
    sign_in(client, "hr")
    assert (
        client.post("/api/hr/onboarding", json=employee(create_account=True, **changes)).status_code
        == 422
    )
    assert client.get("/api/employees/NEW1").status_code == 404
    with next(client.app.dependency_overrides[get_session]()) as session:
        assert session.get(Account, "cq_new1") is None
        assert session.get(Document, "onboarding:NEW1") is None


def test_duplicate_id_or_account_never_overwrites(client):
    original = create(client, create_account=True)
    assert (
        client.post("/api/hr/onboarding", json=employee(full_name="Replacement")).status_code == 409
    )
    # IDs are case-sensitive, generated logins case-insensitive; a collision is atomic.
    assert (
        client.post(
            "/api/hr/onboarding", json=employee(employee_id="new1", create_account=True)
        ).status_code
        == 409
    )
    assert client.get("/api/employees/new1").status_code == 404
    assert client.post("/api/auth/login", json=original["access"]).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"assessed_on": "2024-12-31"},
        {"assessed_on": "2026-10-02"},
        {"note": "        "},
        {"ratings": []},
        {"ratings": [{"skill_id": "UNKNOWN", "level": 1, "evidence": "Synthetic evidence"}]},
        {"ratings": [{"skill_id": "SK_SYSTEM", "level": 6, "evidence": "Synthetic evidence"}]},
        {"ratings": [{"skill_id": "SK_SYSTEM", "level": True, "evidence": "Synthetic evidence"}]},
        {"ratings": [{"skill_id": "SK_SYSTEM", "level": 1, "evidence": "        "}]},
        {
            "ratings": [
                {"skill_id": "SK_SYSTEM", "level": 1, "evidence": "Synthetic evidence"},
                {"skill_id": "SK_SYSTEM", "level": 2, "evidence": "Synthetic evidence"},
            ]
        },
    ],
)
def test_invalid_assessment_keeps_pending(client, changes):
    create(client)
    assert (
        client.post(
            "/api/hr/employees/NEW1/initial-assessment", json=assessment(**changes)
        ).status_code
        == 422
    )
    profile = client.get("/api/employees/NEW1").json()
    assert profile["onboarding"]["status"] == "pending_assessment"
    assert profile["assessment"] is None and profile["levels"] == {}


def test_onboarding_permissions_and_pending_signal(client):
    assert client.post("/api/hr/onboarding", json=employee()).status_code == 401
    sign_in(client)
    assert client.post("/api/hr/onboarding", json=employee()).status_code == 403
    create(client)
    row = next(
        e for e in client.get("/api/hr/overview").json()["employees"] if e["employee_id"] == "NEW1"
    )
    assert "Нужна первичная оценка навыков" in row["signals"]
    assert not any("90 дней" in signal for signal in row["signals"])


def test_months_do_not_assume_thirty_day_months():
    assert elapsed_months("2026-01-31", "2026-02-28") == 0
    assert elapsed_months("2026-01-01", "2026-10-01") == 9
