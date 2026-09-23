"""The evaluation checks themselves must catch bad answers; no model calls here."""

from evals.ai_quality import check_briefing, check_explanations

PROFILE = {
    "employee": {"full_name": "Arman Zhaksylykov", "employee_id": "E0002"},
    "as_of": "2026-10-01",
    "readiness": 62,
    "gaps": [{"current": 1, "required": 4, "critical": True}],
    "recommendations": [
        {
            "event_id": "EV_005",
            "title": "System Design Fundamentals",
            "duration_hours": 16,
            "next_session": "2026-11-23",
            "past_misses": 0,
            "similar_misses": 0,
            "benefits": [{"from": 1, "to": 2}],
        }
    ],
}
TITLES = {"System Design Fundamentals", "Public Speaking Club"}


def test_good_answers_pass():
    good = {"explanations": {"EV_005": "Развивает System Design с 1 до 2. Затраты — 16 часов."}}
    assert check_explanations(PROFILE, good, TITLES) == ([], [])
    brief = {
        "briefing": {
            "summary": "Готовность 62%, System Design 1 из 4.",
            "talking_points": ["Какие задачи помогут?", "Какой формат удобен?"],
            "next_step": "Записаться на System Design Fundamentals.",
            "event_id": "EV_005",
        }
    }
    assert check_briefing(PROFILE, {"growth": None}, brief, TITLES) == ([], [])


def test_bad_answers_are_caught():
    bad = {
        "explanations": {
            "EV_005": "С 1 до 3 за 20 часов, как Public Speaking Club. "
            "Было 2 пропуска. Гарантирует повышение, Arman."
        }
    }
    facts, safe = check_explanations(PROFILE, bad, TITLES)
    assert any("уровни (1, 3)" in f for f in facts)
    assert any("20 ч" in f for f in facts)
    assert any("Public Speaking Club" in f for f in facts)
    assert any("пропуски, которых нет" in f for f in facts)
    assert any("гарантир" in s for s in safe) and any("Arman" in s for s in safe)
    brief = {
        "briefing": {
            "summary": "Готовность 90%.",
            "talking_points": ["a", "b"],
            "next_step": "Пройти System Design Fundamentals за две недели.",
            "event_id": "EV_005",
        }
    }
    facts, _ = check_briefing(PROFILE, {"growth": None}, brief, TITLES)
    assert "90% не из фактов" in facts
    assert any("позже 2 недель" in f for f in facts)
