"""HR-view insights: missing next steps, growth readiness and participation by activity.

All values are computed from stored facts. They support a conversation and never change
skill levels, goals or support priority.
"""

from datetime import date, timedelta

from app.domain import apply_gains, current_skills

NEGATIVE = {"no_show", "dropped", "declined"}
GROWTH_WEIGHTS = {
    "readiness": 0.35,
    "critical": 0.25,
    "momentum": 0.15,
    "solid": 0.15,
    "engaged": 0.10,
}
GROWTH_READY = 65
NO_STEP = {
    "assessment": "Нужна первичная оценка навыков",
    "no_goal": "HR ещё не назначил цель",
    "goal_met": "Требования цели выполнены",
    "not_in_catalog": "В каталоге нет мероприятий по разрывам для этой роли и грейда",
    "prerequisites": "Подходящие мероприятия закрыты предпосылками",
    "completed": "Подходящее обучение уже пройдено или идёт",
    "no_sessions": "У подходящих мероприятий нет ближайших сессий",
    "ceiling": "Курсы не дают прироста до требуемого уровня",
    "pending": "Подходящее обучение ждёт подтверждения HR",
}


def clamp(value):
    return max(0.0, min(1.0, value))


def no_step_reason(employee, levels, gaps, events, history, as_of, pending=(), assessment=False):
    """Why the recommendation engine returned nothing. Checks mirror `domain.eligible`."""
    if assessment:
        return "assessment"
    if not employee.get("career_goal"):
        return "no_goal"
    open_gaps = {g["skill_id"] for g in gaps if g["gap"] > 0}
    if not open_gaps:
        return "goal_met"
    relevant = [
        e
        for e in events.values()
        if not e["mandatory"]
        and not e.get("retired")
        and employee["role"] in e["target_roles"]
        and employee["grade"] in e["target_grades"]
        and open_gaps & {d["skill_id"] for d in e["develops_skills"]}
    ]
    if not relevant:
        return "not_in_catalog"
    useful = [
        e
        for e in relevant
        if any(apply_gains(levels, e).get(s, 0) > levels.get(s, 0) for s in open_gaps)
    ]
    if not useful:
        return "ceiling"
    own = [r for r in history if r["employee_id"] == employee["employee_id"] and r["date"] <= as_of]

    def taken(event):
        rows = [r for r in own if r["event_id"] == event["event_id"]]
        if any(r["status"] == "in_progress" for r in rows):
            return True
        return event["event_id"] != "EV_036" and any(r["status"] == "completed" for r in rows)

    open_events = [e for e in useful if not taken(e)]
    if not open_events:
        return "completed"
    if all(e["event_id"] in pending for e in open_events):
        return "pending"
    allowed = [
        e for e in open_events if all(levels.get(s, 0) >= m for s, m in e["prerequisites"].items())
    ]
    if not allowed:
        return "prerequisites"
    return "no_sessions"


def growth_readiness(employee, levels, gaps, history, events, as_of, current_profile, ready):
    """Who may be ready for a promotion conversation: 100 × Σ weight × part."""
    if ready is None or not employee.get("career_goal"):
        return None
    year = (date.fromisoformat(as_of) - timedelta(days=365)).isoformat()
    own = [r for r in history if r["employee_id"] == employee["employee_id"] and r["date"] <= as_of]
    before = current_skills(employee, [r for r in own if r["date"] < year], events, as_of)
    voluntary = [r for r in own if r["date"] >= year and not events[r["event_id"]]["mandatory"]]
    done = sum(r["status"] == "completed" for r in voluntary)
    missed = sum(r["status"] in NEGATIVE for r in voluntary)
    critical = [g for g in gaps if g["critical"]]
    required = current_profile["required_skills"] if current_profile else {}
    total = sum(required.values())
    coverage = (
        100 * sum(min(levels.get(k, 0), v) for k, v in required.items()) / total if total else 100
    )
    parts = {
        "readiness": clamp((ready - 60) / 35),
        "critical": sum(g["gap"] == 0 for g in critical) / len(critical) if critical else 1.0,
        "momentum": clamp(sum(max(0, v - before.get(k, 0)) for k, v in levels.items()) / 4),
        "solid": clamp((coverage - 80) / 20),
        "engaged": clamp(done / 4) * (1 if missed <= done else 0.5),
    }
    score = round(sum(100 * GROWTH_WEIGHTS[k] * v for k, v in parts.items()))
    return {
        "score": score,
        "ready": score >= GROWTH_READY,
        "parts": {k: round(v, 2) for k, v in parts.items()},
    }


def participation(employee_ids, history, events, as_of):
    """Participation by activity for the authorised team, most attended first."""
    stats = {}
    for r in history:
        if r["employee_id"] not in employee_ids or r["date"] > as_of:
            continue
        s = stats.setdefault(
            r["event_id"],
            {"people": set(), "completed": 0, "no_show": 0, "dropped": 0, "declined": 0,
             "in_progress": 0, "overdue": 0},
        )  # fmt: skip
        s["people"].add(r["employee_id"])
        s[r["status"]] = s.get(r["status"], 0) + 1
    rows = []
    for eid, s in stats.items():
        event = events[eid]
        # Overdue assignments count against completion; in-progress ones are still open.
        finished = s["completed"] + s["no_show"] + s["dropped"] + s["declined"] + s["overdue"]
        rows.append(
            {
                "event_id": eid,
                "title": event["title"],
                "type": event["type"],
                "format": event["format"],
                "mandatory": event["mandatory"],
                "participants": len(s["people"]),
                **{
                    k: s[k]
                    for k in (
                        "completed",
                        "no_show",
                        "dropped",
                        "declined",
                        "in_progress",
                        "overdue",
                    )
                },
                "completion_rate": round(100 * s["completed"] / finished) if finished else None,
            }
        )
    return sorted(rows, key=lambda r: (-r["participants"], r["title"]))
