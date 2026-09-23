import asyncio

import pytest
from app import ai
from app.config import settings
from app.db import get_session
from app.models import Account
from conftest import sign_in


def add_expert(client):
    provider = client.app.dependency_overrides[get_session]()
    with next(provider) as session:
        hr = session.get(Account, "hr")
        session.add(Account(username="expert", role="hr", password_hash=hr.password_hash))
        session.commit()
    provider.close()


def course(**changes):
    return {
        "title": "System Design Deep Dive",
        "description": "Practical course on designing resilient services.",
        "type": "course",
        "format": "self_paced",
        "duration_hours": 6,
        "target_roles": ["Backend Engineer"],
        "target_grades": ["Middle"],
        "develops_skills": [{"skill_id": "SK_SYSTEM", "gain": 1, "max_level": 4}],
        "prerequisites": {},
        "upcoming_sessions": [],
        "quiz": {
            "pass_score": 50,
            "questions": [
                {"question": "What limits throughput?", "options": ["A", "B"], "correct": 1},
                {"question": "What adds resilience?", "options": ["C", "D"], "correct": 0},
            ],
        },
        "revision": 0,
        **changes,
    }


def publish(client, body=None):
    add_expert(client)
    sign_in(client, "hr")
    created = client.post("/api/hr/courses", json=body or course()).json()
    cid = created["course_id"]
    assert client.post(f"/api/hr/courses/{cid}/submit").json()["status"] == "in_review"
    client.post("/api/auth/login", json={"username": "expert", "password": "test-password"})
    decision = {"decision": "approved", "note": "Checked by expert"}
    assert client.post(f"/api/hr/courses/{cid}/review", json=decision).status_code == 200
    return cid, client.post(f"/api/hr/courses/{cid}/publish").json()


def test_draft_validation_and_hr_only(client):
    sign_in(client)
    assert client.post("/api/hr/courses", json=course()).status_code == 403
    sign_in(client, "hr")
    bad = [
        course(develops_skills=[{"skill_id": "SK_UNKNOWN", "gain": 1, "max_level": 3}]),
        course(upcoming_sessions=["2026-11-01"]),
        course(format="online", upcoming_sessions=["2026-09-01"]),
        course(target_roles=["Astronaut"]),
        course(
            quiz={
                "pass_score": 60,
                "questions": [{"question": "Which?", "options": ["A", "B"], "correct": 5}],
            }
        ),
    ]
    for body in bad:
        assert client.post("/api/hr/courses", json=body).status_code == 422
    assert client.post("/api/hr/courses", json=course()).json()["status"] == "draft"


def test_four_eyes_review_and_explicit_publication(client):
    add_expert(client)
    sign_in(client, "hr")
    cid = client.post("/api/hr/courses", json=course()).json()["course_id"]
    assert client.post(f"/api/hr/courses/{cid}/publish").status_code == 409
    client.post(f"/api/hr/courses/{cid}/submit")
    decision = {"decision": "approved", "note": "Self review"}
    assert client.post(f"/api/hr/courses/{cid}/review", json=decision).status_code == 403
    edit = client.put(f"/api/hr/courses/{cid}", json=course(revision=2))
    assert edit.status_code == 409  # a draft under review is frozen
    events = [e["event_id"] for e in client.get("/api/catalog").json()["events"]]
    assert not any(e.startswith("CQ_EV_") for e in events)


def test_published_course_is_recommended_and_quiz_leads_to_hr_review(client):
    cid, published = publish(client)
    event_id = published["event_id"]
    assert published["status"] == "published" and event_id == "CQ_EV_001"
    sign_in(client)
    profile = client.get("/api/employees/E1").json()
    assert event_id in [r["event_id"] for r in profile["recommendations"]]
    quiz = client.get(f"/api/courses/{event_id}/quiz").json()
    assert "correct" not in str(quiz) and len(quiz["questions"]) == 2
    failed = client.post(f"/api/employees/E1/quiz/{event_id}", json={"answers": [0, 1]}).json()
    assert not failed["passed"] and failed["attempts_left"] == 2 and failed["completion"] is None
    passed = client.post(f"/api/employees/E1/quiz/{event_id}", json={"answers": [1, 0]}).json()
    assert passed["passed"] and passed["completion"]["status"] == "pending"
    assert (
        client.post(f"/api/employees/E1/quiz/{event_id}", json={"answers": [1, 0]}).status_code
        == 409
    )
    levels = client.get("/api/employees/E1").json()["levels"]
    assert levels["SK_SYSTEM"] == 1  # nothing is gained before HR confirms the completion
    assert (
        client.post(f"/api/employees/E2/quiz/{event_id}", json={"answers": [1, 0]}).status_code
        == 403
    )


def test_attempt_limit(client):
    _, published = publish(client)
    sign_in(client)
    url = f"/api/employees/E1/quiz/{published['event_id']}"
    for _ in range(3):
        assert client.post(url, json={"answers": [0, 1]}).status_code == 200
    assert client.post(url, json={"answers": [1, 0]}).status_code == 409


def test_new_version_retires_previous_event_but_keeps_its_quiz(client):
    cid, first = publish(client)
    sign_in(client, "hr")
    draft = client.post(f"/api/hr/courses/{cid}/new-version").json()
    assert draft["status"] == "draft" and draft["version"] == 2
    body = course(title="System Design Deep Dive v2", revision=draft["revision"])
    assert client.put(f"/api/hr/courses/{cid}", json=body).status_code == 200
    client.post(f"/api/hr/courses/{cid}/submit")
    client.post("/api/auth/login", json={"username": "expert", "password": "test-password"})
    client.post(f"/api/hr/courses/{cid}/review", json={"decision": "approved", "note": "OK v2"})
    second = client.post(f"/api/hr/courses/{cid}/publish").json()
    assert second["event_id"] == "CQ_EV_002" and first["event_id"] in second["previous_event_ids"]
    events = {e["event_id"]: e for e in client.get("/api/catalog").json()["events"]}
    assert events[first["event_id"]]["retired"] and not events[second["event_id"]].get("retired")
    sign_in(client)
    recs = [r["event_id"] for r in client.get("/api/employees/E1").json()["recommendations"]]
    assert first["event_id"] not in recs and second["event_id"] in recs
    assert client.get(f"/api/courses/{first['event_id']}/quiz").status_code == 200


def test_archive_removes_course_from_recommendations(client):
    cid, published = publish(client)
    client.post(f"/api/hr/courses/{cid}/archive")
    sign_in(client)
    recs = [r["event_id"] for r in client.get("/api/employees/E1").json()["recommendations"]]
    assert published["event_id"] not in recs


def test_ai_draft_is_a_suggestion_only(client, monkeypatch):
    sign_in(client, "hr")
    cid = client.post("/api/hr/courses", json=course()).json()["course_id"]
    assert client.post(f"/api/hr/courses/{cid}/ai-draft").json()["mode"] == "rules"
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "mock-not-a-key")

    async def fake(context):
        assert context["skills"][0]["skill_id"] == "SK_SYSTEM"
        return {"description": "Suggested description " * 3, "questions": []}

    monkeypatch.setattr(ai, "draft_course", fake)
    reply = client.post(f"/api/hr/courses/{cid}/ai-draft").json()
    assert reply["mode"] == "ai" and reply["suggestion"]["description"]
    stored = next(c for c in client.get("/api/hr/courses").json() if c["course_id"] == cid)
    assert stored["draft"]["description"] == course()["description"]  # nothing auto-applied


def test_ai_draft_rejects_questions_on_other_skills(monkeypatch):
    from pydantic_ai.messages import ModelResponse, TextPart
    from pydantic_ai.models.function import FunctionModel

    def off_topic(messages, info):
        q = '{"question": "Unrelated?", "options": ["a", "b", "c", "d"], "correct": 0, "skill_id": "SK_OTHER"}'
        body = '{"description": "' + "Forty characters of description text. " * 2 + '", '
        body += '"questions": [' + ", ".join([q] * 3) + "]}"
        return ModelResponse(parts=[TextPart(body)])

    monkeypatch.setattr(ai, "OpenAIResponsesModel", lambda *a, **k: FunctionModel(off_topic))
    with pytest.raises(ValueError, match="outside the draft"):
        asyncio.run(ai.draft_course_with_provider({"skills": [{"skill_id": "SK_SYSTEM"}]}, None))
