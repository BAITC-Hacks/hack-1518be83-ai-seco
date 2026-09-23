from app.domain import apply_gains, current_skills, eligible, gap_rows, readiness, recommendations


def row(event="EV_001", when="2026-09-10", status="completed", rid="R1"):
    return {
        "employee_id": "E1",
        "event_id": event,
        "date": when,
        "status": status,
        "record_id": rid,
    }


def test_cap_never_reduces_higher_skill(data):
    _, _, events = data
    assert apply_gains({"SK_SYSTEM": 5}, events["EV_001"])["SK_SYSTEM"] == 5
    assert apply_gains({"SK_SYSTEM": 3}, events["EV_001"])["SK_SYSTEM"] == 3


def test_only_completed_after_review_once_and_as_of(data):
    employee, _, events = data
    history = [
        row(),
        row(),
        row(when="2026-08-20", rid="R2"),
        row(status="in_progress", rid="R3"),
        row(when="2026-11-01", rid="R4"),
    ]
    assert current_skills(employee, history, events, "2026-10-01")["SK_SYSTEM"] == 2


def test_filters_audience_prerequisites_date_and_mandatory(data):
    e, _, events = data
    base = events["EV_001"]
    for event in [
        {**base, "mandatory": True},
        {**base, "target_roles": ["QA"]},
        {**base, "target_grades": ["Lead"]},
        {**base, "prerequisites": {"SK_SYSTEM": 3}},
        {**base, "format": "online", "upcoming_sessions": ["2026-09-01"]},
    ]:
        assert not eligible(e, e["skills"], event, [], "2026-10-01")
    assert not eligible(e, e["skills"], base, [row()], "2026-10-01")
    assert not eligible(e, e["skills"], base, [row(status="in_progress")], "2026-10-01")
    assert eligible(e, e["skills"], events["EV_036"], [row(event="EV_036")], "2026-10-01")


def test_critical_gap_prioritized_over_lowest_skill(data):
    e, skills, events = data
    gaps = gap_rows(
        e, e["skills"], skills["role_profiles"], {s["skill_id"]: s for s in skills["skills"]}
    )
    result = recommendations(e, e["skills"], gaps, events, [], "2026-10-01")
    assert result[0]["event_id"] == "EV_001"
    assert len(result) <= 3
    assert readiness(gaps) == 17
    assert (
        recommendations({**e, "career_goal": None}, e["skills"], gaps, events, [], "2026-10-01")
        == []
    )


def test_history_penalty_and_pending_filter(data):
    e, skills, events = data
    gaps = gap_rows(
        e, e["skills"], skills["role_profiles"], {s["skill_id"]: s for s in skills["skills"]}
    )
    history = [row(event="EV_036", status="no_show", rid=f"R{i}") for i in range(3)]
    result = recommendations(
        e, e["skills"], gaps, events, history, "2026-10-01", pending=["EV_001"]
    )
    assert len(result) == 1 and result[0]["past_misses"] == 3


def test_missing_skill_is_unassessed(data):
    e, skills, _ = data
    gaps = gap_rows(e, {}, skills["role_profiles"], {s["skill_id"]: s for s in skills["skills"]})
    assert all(not row["assessed"] and row["current"] == 0 for row in gaps)
