"""Team analytics: support priority and growth readiness.

Both scores are transparent product heuristics for the hackathon demo, not HR norms.
They are shown to HR and managers only, always together with their factors.
"""

from datetime import date, timedelta

from app.domain import current_skills, find_profile, profile_gaps, readiness, target_profile

NEGATIVE = {"no_show", "dropped", "declined"}
PRIORITY_LABELS = {"high": "Высокий", "medium": "Средний", "planned": "Плановый"}
SUPPORT_WEIGHTS = {
    "critical_debt": 0.30,
    "grade_debt": 0.20,
    "stagnation": 0.20,
    "disengagement": 0.15,
    "no_goal": 0.15,
}
SUPPORT_HIGH, SUPPORT_MEDIUM = 50, 40
GROWTH_WEIGHTS = {
    "readiness": 0.35,
    "critical": 0.25,
    "momentum": 0.15,
    "solid": 0.15,
    "engaged": 0.10,
}
GROWTH_READY = 65


def clamp(value):
    return max(0.0, min(1.0, value))


def days_before(as_of, days):
    return (date.fromisoformat(as_of) - timedelta(days=days)).isoformat()


def plural(n, one, few, many):
    tail, tens = n % 10, n % 100
    word = (
        one
        if tail == 1 and tens != 11
        else few
        if 2 <= tail <= 4 and not 12 <= tens <= 14
        else many
    )
    return f"{n} {word}"


def latest_by_event(history):
    latest = {}
    for row in sorted(history, key=lambda r: (r["date"], r["record_id"])):
        latest[row["event_id"]] = row
    return list(latest.values())


def employee_facts(employee, history, events, skills_payload, as_of):
    """Everything the scores need, computed from the dataset only. `history` is the employee's own."""
    skill_names = {s["skill_id"]: s for s in skills_payload["skills"]}
    profiles = skills_payload["role_profiles"]
    levels = current_skills(employee, history, events, as_of)
    target, chosen = target_profile(employee, profiles)
    gaps = profile_gaps(target, levels, skill_names) if target else []
    current = find_profile(profiles, employee["role"], employee["grade"])
    required = current["required_skills"] if current else {}
    total = sum(required.values())
    coverage = (
        round(100 * sum(min(levels.get(k, 0), v) for k, v in required.items()) / total)
        if total
        else 100
    )
    critical = current["critical_skills"] if current else []
    critical_missing = [
        {
            "name": skill_names.get(k, {}).get("name", k),
            "current": levels.get(k, 0),
            "required": required[k],
        }
        for k in critical
        if levels.get(k, 0) < required.get(k, 0)
    ]
    six_months, year = days_before(as_of, 180), days_before(as_of, 365)
    voluntary = [
        r for r in history if not events[r["event_id"]]["mandatory"] and r["date"] <= as_of
    ]
    last_year = [r for r in voluntary if r["date"] >= year]
    before_year = current_skills(employee, [r for r in history if r["date"] < year], events, as_of)
    pending_mandatory = [
        r
        for r in latest_by_event(history)
        if events[r["event_id"]]["mandatory"] and r["status"] != "completed"
    ]
    target_critical = [g for g in gaps if g["critical"]]
    return {
        "levels": levels,
        "target": {
            "role": target["role"] if target else employee["role"],
            "grade": target["grade"] if target else employee["grade"],
            "chosen": chosen,
        },
        "gaps": gaps,
        "readiness": readiness(gaps) if gaps else 100,
        "target_critical_total": len(target_critical),
        "target_critical_closed": sum(g["gap"] == 0 for g in target_critical),
        "coverage": coverage,
        "critical_debt": sum(m["required"] - m["current"] for m in critical_missing),
        "critical_missing": critical_missing,
        "done_6m": sum(r["status"] == "completed" and r["date"] >= six_months for r in voluntary),
        "done_12m": sum(r["status"] == "completed" for r in last_year),
        "missed_12m": sum(r["status"] in NEGATIVE for r in last_year),
        "gains_12m": sum(max(0, v - before_year.get(k, 0)) for k, v in levels.items()),
        "last_completion": max(
            (r["date"] for r in voluntary if r["status"] == "completed"), default=None
        ),
        "pending_mandatory": pending_mandatory,
        "overdue_mandatory": [
            r
            for r in pending_mandatory
            if r["status"] == "overdue" or (r.get("due_date") and r["due_date"] < as_of)
        ],
        "tenure": employee["tenure_months"],
        "has_goal": bool(employee.get("career_goal")),
    }


def support_priority(f):
    """Who may need help: 100 × Σ weight × factor, every factor in [0, 1]."""
    trust = clamp(f["tenure"] / 12)  # newcomers are not expected to meet the grade yet
    missing = ", ".join(
        f"{m['name']} {m['current']}→{m['required']}" for m in f["critical_missing"]
    )
    factors = [
        (
            "critical_debt",
            "Ключевые навыки ниже текущего грейда",
            clamp(f["critical_debt"] / 3) * trust,
            missing,
        ),
        (
            "grade_debt",
            "Требования текущего грейда закрыты не полностью",
            clamp((85 - f["coverage"]) / 25) * trust,
            f"Покрытие текущего грейда {f['coverage']}%",
        ),
        (
            "stagnation",
            "Нет завершённого добровольного обучения за 6 месяцев",
            1.0 if f["done_6m"] == 0 and f["tenure"] >= 6 else 0.0,
            "последнее — " + f["last_completion"] if f["last_completion"] else "в истории нет",
        ),
        (
            "disengagement",
            "Пропусков и отказов больше, чем завершений",
            clamp((f["missed_12m"] - f["done_12m"] + 2) / 4) if f["missed_12m"] >= 2 else 0.0,
            f"За 12 месяцев: {plural(f['missed_12m'], 'пропуск или отказ', 'пропуска или отказа', 'пропусков или отказов')}, "
            f"{plural(f['done_12m'], 'завершение', 'завершения', 'завершений')}",
        ),
        (
            "no_goal",
            "Нет карьерной цели при стаже от года",
            1.0 if not f["has_goal"] and f["tenure"] >= 12 else 0.0,
            f"Стаж {f['tenure']} мес.",
        ),
    ]
    rows = [
        {
            "key": key,
            "label": label,
            "weight": SUPPORT_WEIGHTS[key],
            "value": round(value, 2),
            "points": round(100 * SUPPORT_WEIGHTS[key] * value, 1),
            "detail": detail,
        }
        for key, label, value, detail in factors
    ]
    score = round(sum(r["points"] for r in rows))
    level = "high" if score >= SUPPORT_HIGH else "medium" if score >= SUPPORT_MEDIUM else "planned"
    reasons = [
        f"{r['label']}: {r['detail']}" if r["detail"] else r["label"]
        for r in sorted(rows, key=lambda r: -r["points"])
        if r["points"] > 0
    ] or ["Существенных сигналов нет. Плановое развитие."]
    return {
        "level": level,
        "label": PRIORITY_LABELS[level],
        "score": score,
        "factors": rows,
        "reasons": reasons,
        # Compliance is shown separately and never mixed into development scores.
        "overdue_mandatory": len(f["overdue_mandatory"]),
    }


def growth_readiness(f):
    """Who may be ready for a promotion conversation."""
    closed = (
        f["target_critical_closed"] / f["target_critical_total"]
        if f["target_critical_total"]
        else 1
    )
    parts = {
        "readiness": clamp((f["readiness"] - 60) / 35),
        "critical": closed,
        "momentum": clamp(f["gains_12m"] / 4),
        "solid": clamp((f["coverage"] - 80) / 20),
        "engaged": clamp(f["done_12m"] / 4) * (1 if f["missed_12m"] <= f["done_12m"] else 0.5),
    }
    score = round(sum(100 * GROWTH_WEIGHTS[k] * v for k, v in parts.items()))
    return {
        "score": score,
        "ready": score >= GROWTH_READY,
        "parts": {k: round(v, 2) for k, v in parts.items()},
    }
