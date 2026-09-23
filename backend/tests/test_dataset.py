"""Optional full-kit regression: skips when the privately supplied kit is absent."""

import csv
import json

import pytest
from app.config import settings
from app.domain import current_skills, eligible, gap_rows, recommendations
from app.seed import validate_import


def test_all_supplied_profiles_keep_catalog_constraints():
    path = settings.dataset_path
    if not (path / "employees.json").is_file():
        pytest.skip("Organizer dataset is not distributed with the repository")
    employees = json.loads((path / "employees.json").read_text())["employees"]
    catalog = {
        kind: json.loads((path / f"{kind}.json").read_text()) for kind in ("skills", "events")
    }
    with (path / "activity_history.csv").open() as source:
        employees, history = validate_import(employees, list(csv.DictReader(source)), catalog)
    events = {e["event_id"]: e for e in catalog["events"]["events"]}
    skills = {s["skill_id"]: s for s in catalog["skills"]["skills"]}
    as_of = catalog["skills"]["meta"]["as_of_date"]
    for e in employees:
        levels = current_skills(e, history, events, as_of)
        gaps = gap_rows(e, levels, catalog["skills"]["role_profiles"], skills)
        recs = recommendations(e, levels, gaps, events, history, as_of)
        assert len(recs) <= 3
        assert len({r["event_id"] for r in recs}) == len(recs)
        assert all(0 <= level <= 5 for level in levels.values())
        for r in recs:
            assert eligible(e, levels, events[r["event_id"]], history, as_of)
            assert r["benefits"] and r["reason"]
