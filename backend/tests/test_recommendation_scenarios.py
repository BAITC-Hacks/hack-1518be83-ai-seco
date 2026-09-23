import copy
import json

from app.domain import gap_rows, recommendations
from conftest import sign_in


def test_three_jury_style_profiles_import_and_recommendations(client, data):
    base, skills, events = data
    sign_in(client, "hr")
    cases = []
    for suffix, levels in [
        ("CRITICAL", {"SK_SYSTEM": 1, "SK_SPEAK": 0}),
        ("READY", {"SK_SYSTEM": 4, "SK_SPEAK": 2}),
        ("NO_GOAL", {"SK_SYSTEM": 0, "SK_SPEAK": 0}),
    ]:
        cases.append(
            {
                **copy.deepcopy(base),
                "employee_id": f"CHECK_{suffix}",
                "full_name": f"Synthetic check {suffix}",
                "skills": levels,
                "career_goal": None if suffix == "NO_GOAL" else base["career_goal"],
            }
        )
    history = "record_id,employee_id,event_id,date,status,completion_pct,assigned_by\n"
    for i, day in enumerate(["2026-08-01", "2026-09-01", "2026-09-15"]):
        history += f"CHECK_R{i},CHECK_CRITICAL,EV_036,{day},no_show,0,self\n"
    result = client.post(
        "/api/hr/import",
        files={
            "employees": ("check.json", json.dumps({"employees": cases})),
            "history": ("check.csv", history),
        },
    )
    assert result.status_code == 200
    first = client.get("/api/employees/CHECK_CRITICAL").json()
    assert first["recommendations"][0]["event_id"] == "EV_001"  # Not the lowest skill.
    assert first["recommendations"][1]["past_misses"] == 3
    ready = client.get("/api/employees/CHECK_READY").json()
    assert ready["readiness"] == 100 and ready["recommendations"] == []
    no_goal = client.get("/api/employees/CHECK_NO_GOAL").json()
    assert no_goal["readiness"] is None and no_goal["recommendations"] == []


def test_similar_skill_history_not_unrelated_same_format(data):
    employee, skills, source_events = data
    events = copy.deepcopy(source_events)
    events["EV_SPEAK_2"] = {**events["EV_036"], "event_id": "EV_SPEAK_2"}
    gaps = gap_rows(
        employee,
        employee["skills"],
        skills["role_profiles"],
        {s["skill_id"]: s for s in skills["skills"]},
    )
    records = [
        {
            "record_id": f"R{i}",
            "employee_id": "E1",
            "event_id": "EV_SPEAK_2",
            "date": "2026-09-10",
            "status": "no_show",
        }
        for i in range(3)
    ]
    result = {
        r["event_id"]: r
        for r in recommendations(employee, employee["skills"], gaps, events, records, "2026-10-01")
    }
    assert result["EV_036"]["similar_misses"] == 3
    assert result["EV_001"]["similar_misses"] == 0  # Same format, different skill.
    assert result["EV_036"]["past_misses"] == 0
    assert "тем же навыкам" in result["EV_036"]["reason"]


def test_similar_history_excludes_mandatory_old_future_and_other_people(data):
    employee, skills, source_events = data
    events = copy.deepcopy(source_events)
    events["EV_SPEAK_2"] = {**events["EV_036"], "event_id": "EV_SPEAK_2"}
    events["EV_002"]["develops_skills"] = events["EV_036"]["develops_skills"]
    gaps = gap_rows(
        employee,
        employee["skills"],
        skills["role_profiles"],
        {s["skill_id"]: s for s in skills["skills"]},
    )
    records = [
        {
            "record_id": str(i),
            "employee_id": eid,
            "event_id": event,
            "date": when,
            "status": "no_show",
        }
        for i, (eid, event, when) in enumerate(
            [
                ("E1", "EV_002", "2026-09-01"),
                ("E1", "EV_SPEAK_2", "2026-01-01"),
                ("E1", "EV_SPEAK_2", "2026-11-01"),
                ("E2", "EV_SPEAK_2", "2026-09-01"),
            ]
        )
    ]
    result = recommendations(employee, employee["skills"], gaps, events, records, "2026-10-01")
    assert all(r["similar_misses"] == 0 for r in result)


def test_high_gap_never_bypasses_prerequisite_or_skill_cap(data):
    employee, skills, source_events = data
    events = copy.deepcopy(source_events)
    gaps = gap_rows(
        employee,
        employee["skills"],
        skills["role_profiles"],
        {s["skill_id"]: s for s in skills["skills"]},
    )
    events["EV_001"]["prerequisites"] = {"SK_SYSTEM": 2}
    assert [
        r["event_id"]
        for r in recommendations(employee, employee["skills"], gaps, events, [], "2026-10-01")
    ] == ["EV_036"]
    events["EV_001"]["prerequisites"] = {}
    events["EV_001"]["develops_skills"][0]["max_level"] = 1
    assert [
        r["event_id"]
        for r in recommendations(employee, employee["skills"], gaps, events, [], "2026-10-01")
    ] == ["EV_036"]
