from app.db import get_session
from app.rewards import seed_demo_rewards
from conftest import sign_in
from test_team import configure_manager


def seed(client):
    provider = client.app.dependency_overrides[get_session]()
    with next(provider) as session:
        seed_demo_rewards(session)
    provider.close()


def completions(client, rows):
    header = "record_id,employee_id,event_id,date,status,completion_pct,assigned_by\n"
    body = "".join(f"R{ev}{day},E1,{ev},{day},completed,100,self\n" for ev, day in rows)
    sign_in(client, "hr")
    assert (
        client.post("/api/hr/import", files={"history": ("h.csv", header + body)}).status_code
        == 200
    )


def book(client):
    sign_in(client)
    data = client.get("/api/rewards/E1").json()
    return next(r for r in data["rewards"] if r["criterion"]["type"] == "voluntary_completions")


def test_claim_requires_server_verified_voluntary_facts(client):
    seed(client)
    reward = book(client)
    assert not reward["eligible"] and reward["progress"] == "0 из 3"
    url = f"/api/employees/E1/rewards/{reward['reward_id']}/claim"
    assert client.post(url, json={}).status_code == 422
    # Mandatory completions never count towards a reward.
    completions(
        client, [("EV_002", "2026-05-01"), ("EV_002", "2026-06-01"), ("EV_002", "2026-07-01")]
    )
    assert not book(client)["eligible"]
    completions(
        client, [("EV_001", "2026-05-01"), ("EV_036", "2026-06-01"), ("EV_036", "2026-07-01")]
    )
    reward = book(client)
    assert reward["eligible"] and len(reward["facts"]) == 3
    claim = client.post(url, json={"note": "Прошу книгу по архитектуре"}).json()
    assert (
        claim["status"] == "pending"
        and claim["criterion_version"] == 1
        and len(claim["facts"]) == 3
    )
    assert client.post(url, json={}).status_code == 409  # already under review


def test_full_lifecycle_and_single_issue(client):
    seed(client)
    completions(
        client, [("EV_001", "2026-05-01"), ("EV_036", "2026-06-01"), ("EV_036", "2026-07-01")]
    )
    rid = book(client)["reward_id"]
    url = f"/api/employees/E1/rewards/{rid}/claim"
    cid = client.post(url, json={}).json()["claim_id"]
    sign_in(client, "hr")
    decision = f"/api/hr/reward-claims/{cid}/decision"
    assert client.post(f"/api/hr/reward-claims/{cid}/issue", json={}).status_code == 409
    assert (
        client.post(decision, json={"decision": "needs_changes", "note": "Добавьте отзыв"}).json()[
            "status"
        ]
        == "needs_changes"
    )
    sign_in(client)
    resubmitted = client.post(
        f"/api/employees/E1/reward-claims/{cid}/resubmit", json={"note": "Отзыв добавлен"}
    )
    assert resubmitted.json()["status"] == "pending"
    sign_in(client, "hr")
    assert (
        client.post(decision, json={"decision": "approved", "note": "Условие выполнено"}).json()[
            "status"
        ]
        == "approved"
    )
    issued = client.post(f"/api/hr/reward-claims/{cid}/issue", json={"note": "Вручено"}).json()
    assert issued["status"] == "issued"
    assert [h["status"] for h in issued["history"]] == [
        "pending",
        "needs_changes",
        "pending",
        "approved",
        "issued",
    ]
    sign_in(client)
    assert client.post(url, json={}).status_code == 409  # never issued twice
    assert book(client)["claim"]["status"] == "issued"


def test_access_rules(client):
    seed(client)
    completions(
        client, [("EV_001", "2026-05-01"), ("EV_036", "2026-06-01"), ("EV_036", "2026-07-01")]
    )
    rid = book(client)["reward_id"]
    sign_in(client)
    assert client.get("/api/rewards/E2").status_code == 403
    assert client.post(f"/api/employees/E2/rewards/{rid}/claim", json={}).status_code == 403
    cid = client.post(f"/api/employees/E1/rewards/{rid}/claim", json={}).json()["claim_id"]
    assert (
        client.post(
            f"/api/hr/reward-claims/{cid}/decision", json={"decision": "approved", "note": "self"}
        ).status_code
        == 403
    )
    assert (
        client.post(f"/api/employees/E1/reward-claims/{cid}/cancel", json={}).json()["status"]
        == "cancelled"
    )
    assert (
        client.post(f"/api/employees/E1/rewards/{rid}/claim", json={}).status_code == 201
    )  # after cancel
    sign_in(client, "hr")
    assert client.post(f"/api/employees/E1/rewards/{rid}/claim", json={}).status_code == 403
    assert len(client.get("/api/hr/rewards").json()["claims"]) == 2
    configure_manager(client)
    sign_in(client, "manager")
    assert client.get("/api/rewards/E1").status_code == 403


def test_hr_catalog_and_criterion_versioning(client):
    sign_in(client, "hr")
    body = {
        "title": "Сертификат за курс",
        "description": "Именной сертификат за добровольный курс.",
        "kind": "other",
        "criterion": {"type": "course_completed", "event_id": "EV_001"},
    }
    reward = client.post("/api/hr/rewards", json=body).json()
    mandatory = {**body, "criterion": {"type": "course_completed", "event_id": "EV_002"}}
    assert client.post("/api/hr/rewards", json=mandatory).status_code == 422
    wrong = {**body, "criterion": {"type": "goal_readiness"}}
    assert client.post("/api/hr/rewards", json=wrong).status_code == 422
    same = client.put(
        f"/api/hr/rewards/{reward['reward_id']}", json={**body, "title": "Новое имя"}
    ).json()
    assert same["version"] == 1
    changed = client.put(
        f"/api/hr/rewards/{reward['reward_id']}",
        json={**body, "criterion": {"type": "course_completed", "event_id": "EV_036"}},
    ).json()
    assert changed["version"] == 2
    sign_in(client)
    assert client.post("/api/hr/rewards", json=body).status_code == 403


def test_goal_based_criteria(client):
    seed(client)
    sign_in(client)
    items = {r["criterion"]["type"]: r for r in client.get("/api/rewards/E1").json()["rewards"]}
    assert (
        not items["goal_readiness"]["eligible"]
        and items["goal_readiness"]["progress"] == "17% из 80%"
    )
    assert not items["goal_critical_closed"]["eligible"]
    sign_in(client, "hr")
    client.put(
        "/api/employees/E1/goal", content="null", headers={"Content-Type": "application/json"}
    )
    sign_in(client)
    items = {r["criterion"]["type"]: r for r in client.get("/api/rewards/E1").json()["rewards"]}
    assert items["goal_readiness"]["progress"].startswith("нужна назначенная HR цель")
