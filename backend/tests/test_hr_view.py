import asyncio

import pytest
from app import ai
from app.config import settings
from app.insights import growth_readiness, no_step_reason, participation
from conftest import sign_in
from test_team import configure_manager


def row(event="EV_001", status="completed", when="2026-09-10", rid="R1", eid="E1"):
    return {"employee_id": eid, "event_id": event, "date": when, "status": status, "record_id": rid}


def test_no_step_reasons_follow_eligibility(data):
    e, _, events = data
    gaps = [{"skill_id": "SK_SYSTEM", "gap": 3, "critical": True}]
    args = (e["skills"], gaps, events)
    assert no_step_reason(e, *args, [], "2026-10-01", assessment=True) == "assessment"
    assert no_step_reason({**e, "career_goal": None}, *args, [], "2026-10-01") == "no_goal"
    assert no_step_reason(e, e["skills"], [], events, [], "2026-10-01") == "goal_met"
    assert no_step_reason({**e, "grade": "Lead"}, *args, [], "2026-10-01") == "not_in_catalog"
    assert no_step_reason(e, {"SK_SYSTEM": 3}, gaps, events, [], "2026-10-01") == "ceiling"
    assert no_step_reason(e, *args, [row()], "2026-10-01") == "completed"
    assert no_step_reason(e, *args, [], "2026-10-01", pending={"EV_001"}) == "pending"
    locked = {**events, "EV_001": {**events["EV_001"], "prerequisites": {"SK_SYSTEM": 2}}}
    assert no_step_reason(e, e["skills"], gaps, locked, [], "2026-10-01") == "prerequisites"


def test_growth_readiness_needs_goal_and_rewards_strong_profile(data):
    e, skills, events = data
    profile = skills["role_profiles"][1]
    closed = [{"skill_id": "SK_SYSTEM", "gap": 0, "critical": True}]
    history = [row(rid=f"R{i}", event="EV_036", when=f"2026-0{i + 1}-10") for i in range(4)]
    strong = {"SK_SYSTEM": 4, "SK_SPEAK": 2}
    result = growth_readiness(e, strong, closed, history, events, "2026-10-01", profile, 95)
    assert result["ready"] and result["score"] >= 65
    assert (
        growth_readiness(
            {**e, "career_goal": None}, strong, closed, [], events, "2026-10-01", profile, 95
        )
        is None
    )
    assert growth_readiness(e, strong, closed, [], events, "2026-10-01", profile, None) is None


def test_participation_counts_overdue_against_completion(data):
    _, _, events = data
    history = [
        row(event="EV_002", rid="R1"),
        row(event="EV_002", rid="R2", eid="E2", status="overdue"),
        row(event="EV_001", rid="R3", status="no_show"),
        row(event="EV_001", rid="R4", eid="E9"),
    ]
    rows = {r["event_id"]: r for r in participation({"E1", "E2"}, history, events, "2026-10-01")}
    assert rows["EV_002"]["participants"] == 2 and rows["EV_002"]["completion_rate"] == 50
    assert rows["EV_001"]["participants"] == 1 and rows["EV_001"]["completion_rate"] == 0


def test_overview_reports_missing_steps_growth_and_activities(client):
    sign_in(client, "hr")
    overview = client.get("/api/team/overview").json()
    first = next(r for r in overview["employees"] if r["employee_id"] == "E1")
    assert first["next_steps"] >= 1 and first["no_step"] is None and first["growth"] is not None
    client.put(
        "/api/employees/E1/goal", content="null", headers={"Content-Type": "application/json"}
    )
    overview = client.get("/api/team/overview").json()
    first = next(r for r in overview["employees"] if r["employee_id"] == "E1")
    assert first["no_step"]["code"] == "no_goal" and first["growth"] is None
    assert overview["no_step"] >= 1
    assert {"code": "no_goal", "text": "HR ещё не назначил цель", "count": 1} in overview[
        "no_step_reasons"
    ]
    assert isinstance(overview["activities"], list) and "growth_ready" in overview


def briefing(**changes):
    return {
        "summary": "Synthetic summary for the conversation.",
        "talking_points": ["Point one", "Point two"],
        "next_step": "Synthetic next step",
        "event_id": None,
        **changes,
    }


def test_ai_briefing_is_anonymous_cached_and_scoped(client, monkeypatch):
    sign_in(client)
    assert client.post("/api/team/employees/E1/ai-briefing").status_code == 403
    sign_in(client, "hr")
    assert client.post("/api/team/employees/E1/ai-briefing").json()["mode"] == "rules"
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "mock-not-a-key")
    calls = []

    async def fake(context):
        calls.append(context)
        text = str(context)
        assert "Demo Employee" not in text and "E1" not in text and "Engineering" not in text
        return briefing(event_id=context["recommendations"][0]["event_id"])

    monkeypatch.setattr(ai, "brief", fake)
    first = client.post("/api/team/employees/E1/ai-briefing").json()
    assert first["mode"] == "ai" and not first["cached"] and first["briefing"]["event_id"]
    assert client.post("/api/team/employees/E1/ai-briefing").json()["cached"]
    assert len(calls) == 1 and calls[0]["today"] == "2026-10-01"
    configure_manager(client)
    sign_in(client, "manager")
    assert client.post("/api/team/employees/E2/ai-briefing").status_code == 403


def test_ai_briefing_rejects_invented_event(monkeypatch):
    from pydantic_ai.messages import ModelResponse, TextPart
    from pydantic_ai.models.function import FunctionModel

    def invented(messages, info):
        body = '{"summary": "Twenty chars summary here.", "talking_points": ["a1", "b2"], '
        body += '"next_step": "Take the invented course", "event_id": "EV_999"}'
        return ModelResponse(parts=[TextPart(body)])

    monkeypatch.setattr(ai, "OpenAIResponsesModel", lambda *a, **k: FunctionModel(invented))
    with pytest.raises(ValueError, match="outside the verified"):
        asyncio.run(ai.brief_with_provider({"recommendations": [{"event_id": "EV_001"}]}, None))
