import copy

import pytest
from app import ai
from app.config import settings
from app.db import get_session
from app.main import app
from app.models import Account, Document
from app.security import password_hash
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture(autouse=True)
def isolate_ai_provider(monkeypatch):
    """Local .env credentials must never turn ordinary tests into paid API calls."""
    monkeypatch.setattr(settings, "ai_enabled", False)
    monkeypatch.setattr(settings, "openai_api_key", "")

    async def unexpected_provider(*args, **kwargs):
        pytest.fail("AI provider must be explicitly mocked in automated tests")

    monkeypatch.setattr(ai, "explain", unexpected_provider)
    monkeypatch.setattr(ai, "summarize_observations", unexpected_provider)
    monkeypatch.setattr(ai, "suggest_criteria", unexpected_provider)
    monkeypatch.setattr(ai, "brief", unexpected_provider)


@pytest.fixture
def data():
    employee = {
        "employee_id": "E1",
        "full_name": "Demo Employee",
        "department": "Engineering",
        "role": "Backend Engineer",
        "grade": "Middle",
        "manager_id": None,
        "hire_date": "2024-01-01",
        "tenure_months": 33,
        "work_format": "remote",
        "preferred_language": "ru",
        "career_goal": {"target_role": "Backend Engineer", "target_grade": "Senior"},
        "skills": {"SK_SYSTEM": 1, "SK_SPEAK": 0},
        "last_review_date": "2026-09-01",
    }
    skills = {
        "meta": {"as_of_date": "2026-10-01"},
        "skills": [
            {"skill_id": "SK_SYSTEM", "name": "System Design"},
            {"skill_id": "SK_SPEAK", "name": "Public Speaking"},
        ],
        "role_profiles": [
            {
                "role": "Backend Engineer",
                "grade": grade,
                "required_skills": {"SK_SYSTEM": 4, "SK_SPEAK": 2},
                "critical_skills": ["SK_SYSTEM"],
            }
            for grade in ["Junior", "Middle", "Senior", "Lead"]
        ],
    }
    base = {
        "description": "Synthetic course",
        "type": "course",
        "format": "self_paced",
        "duration_hours": 4,
        "mandatory": False,
        "target_roles": ["Backend Engineer"],
        "target_grades": ["Middle"],
        "prerequisites": {},
        "upcoming_sessions": [],
    }
    events = {
        "EV_001": {
            **base,
            "event_id": "EV_001",
            "title": "System Design Lab",
            "develops_skills": [{"skill_id": "SK_SYSTEM", "gain": 1, "max_level": 3}],
        },
        "EV_002": {
            **base,
            "event_id": "EV_002",
            "title": "Mandatory",
            "mandatory": True,
            "develops_skills": [],
        },
        "EV_036": {
            **base,
            "event_id": "EV_036",
            "title": "Speaking Club",
            "develops_skills": [{"skill_id": "SK_SPEAK", "gain": 1, "max_level": 3}],
        },
    }
    return employee, skills, events


@pytest.fixture
def client(data):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    employee, skills, events = data
    other = {**copy.deepcopy(employee), "employee_id": "E2", "full_name": "Other Employee"}
    with Session(engine) as session:
        for e in [employee, other]:
            session.add(Document(id=f"employee:{e['employee_id']}", kind="employee", payload=e))
        session.add(Document(id="catalog:skills", kind="catalog", payload=skills))
        session.add(
            Document(id="catalog:events", kind="catalog", payload={"events": list(events.values())})
        )
        hashed = password_hash.hash("test-password")
        session.add(
            Account(username="employee", password_hash=hashed, role="employee", employee_id="E1")
        )
        session.add(Account(username="hr", password_hash=hashed, role="hr"))
        session.commit()

    def get_test_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = get_test_session
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    engine.dispose()


def sign_in(client, role="employee"):
    response = client.post("/api/auth/login", json={"username": role, "password": "test-password"})
    assert response.status_code == 200
