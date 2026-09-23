from app import integrations
from app.analytics import growth_readiness, support_priority
from conftest import sign_in


def facts(**overrides):
    base = {
        "tenure": 24,
        "critical_debt": 0,
        "critical_missing": [],
        "coverage": 90,
        "done_6m": 2,
        "done_12m": 3,
        "missed_12m": 0,
        "last_completion": "2026-09-01",
        "has_goal": True,
        "overdue_mandatory": [],
        "readiness": 70,
        "target_critical_total": 2,
        "target_critical_closed": 1,
        "gains_12m": 1,
    }
    return {**base, **overrides}


def test_support_priority_combines_all_factors():
    worst = facts(
        critical_debt=3,
        coverage=60,
        done_6m=0,
        done_12m=0,
        missed_12m=4,
        has_goal=False,
        last_completion=None,
    )
    result = support_priority(worst)
    assert result["score"] == 100 and result["level"] == "high"
    assert [f["points"] for f in result["factors"]] == [30, 20, 20, 15, 15]
    assert support_priority(facts())["level"] == "planned"


def test_newcomer_is_not_penalised_for_grade_debt():
    newcomer = facts(tenure=0, critical_debt=3, coverage=40, done_6m=0, has_goal=False)
    assert support_priority(newcomer)["score"] == 0


def test_overdue_compliance_is_reported_but_not_scored():
    result = support_priority(facts(overdue_mandatory=[{"event_id": "EV_001"}]))
    assert result["overdue_mandatory"] == 1 and result["score"] == 0


def test_growth_readiness_flags_strong_profile():
    strong = facts(readiness=95, target_critical_closed=2, gains_12m=4, coverage=100, done_12m=4)
    assert growth_readiness(strong)["ready"]
    assert not growth_readiness(facts())["ready"]


def test_github_only_for_people_with_account():
    person = {"employee_id": "E9", "full_name": "Demo", "role": "Sales Manager"}
    assert not integrations.available(person, "github")
    assert integrations.available(person, "jira")
    assert integrations.available({**person, "github_login": "demo-dev"}, "github")


def test_manager_sees_only_own_department(client):
    sign_in(client, "manager")
    overview = client.get("/api/team/overview").json()
    assert {e["employee_id"] for e in overview["employees"]} == {"E1", "E2"}
    assert overview["scope"]["department"] == "Engineering" and overview["pending"] == []
    assert client.get("/api/team/employees/E1").status_code == 200
    assert client.get("/api/team/employees/E7").status_code == 403
    assert client.get("/api/employees/E7").status_code == 403
    assert client.get("/api/hr/overview").status_code == 403
    goal = {"target_role": "Backend Engineer", "target_grade": "Lead"}
    assert client.put("/api/employees/E1/goal", json=goal).status_code == 403


def test_team_views_are_closed_to_employees(client):
    sign_in(client)
    assert client.get("/api/team/overview").status_code == 403
    assert client.get("/api/team/employees/E1").status_code == 403
    sign_in(client, "hr")
    overview = client.get("/api/team/overview", params={"department": "Payments"}).json()
    assert [e["employee_id"] for e in overview["employees"]] == ["E7"]
    assert overview["scope"]["total"] == 3


def test_only_employee_connects_own_sources_with_consent(client):
    sign_in(client, "hr")
    body = {"resources": ["DEMO-BE"], "consent": True}
    assert client.put("/api/employees/E1/integrations/jira", json=body).status_code == 403
    sign_in(client)
    bad = [
        {"resources": ["DEMO-BE"], "consent": False},
        {"resources": ["OTHER-PROJECT"], "consent": True},
        {"resources": [], "consent": True},
    ]
    for payload in bad:
        assert client.put("/api/employees/E1/integrations/jira", json=payload).status_code == 422
    view = client.put("/api/employees/E1/integrations/jira", json=body).json()
    assert view["sources"]["jira"]["status"] == "connected"
    assert view["signal"]["evidence"]
    sign_in(client, "hr")
    card = client.get("/api/team/employees/E1").json()
    assert card["integrations"]["sources"]["jira"]["status"] == "connected"
    assert client.post("/api/team/employees/E1/discuss").json()["ok"]
    assert client.get("/api/team/overview").json()["insights"][0]["discussed"]
    sign_in(client)
    view = client.delete("/api/employees/E1/integrations/jira").json()
    assert view["sources"]["jira"]["status"] == "not_connected" and view["signal"] is None


def test_orientation_is_a_hint_without_recommendations(client):
    sign_in(client)
    client.put(
        "/api/employees/E1/goal", content="null", headers={"Content-Type": "application/json"}
    )
    profile = client.get("/api/employees/E1").json()
    assert profile["orientation"]["grade"] == "Senior"
    assert profile["recommendations"] == [] and profile["readiness"] is None
