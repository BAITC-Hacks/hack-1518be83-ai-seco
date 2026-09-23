"""Deterministic, auditable career calculations. No model assigns numeric skill levels."""

from datetime import date, timedelta
from math import sqrt


def apply_gains(levels: dict, event: dict) -> dict:
    updated = dict(levels)
    for gain in event["develops_skills"]:
        key = gain["skill_id"]
        current = updated.get(key, 0)
        updated[key] = max(current, min(current + gain["gain"], gain["max_level"]))
    return updated


def current_skills(employee, history, events, as_of):
    levels = dict(employee["skills"])
    seen = set()
    for row in sorted(history, key=lambda r: (r["date"], r["record_id"])):
        if row["record_id"] in seen or row["employee_id"] != employee["employee_id"]:
            continue
        seen.add(row["record_id"])
        if row["status"] == "completed" and employee["last_review_date"] < row["date"] <= as_of:
            levels = apply_gains(levels, events[row["event_id"]])
    return levels


def gap_rows(employee, levels, role_profiles, skills):
    goal = employee.get("career_goal")
    if not goal:
        return []
    profile = next(
        (
            p
            for p in role_profiles
            if p["role"] == goal["target_role"] and p["grade"] == goal["target_grade"]
        ),
        None,
    )
    if profile is None:
        return []
    rows = [
        {
            "skill_id": sid,
            "name": skills[sid]["name"],
            "current": levels.get(sid, 0),
            "required": required,
            "gap": max(0, required - levels.get(sid, 0)),
            "critical": sid in profile["critical_skills"],
            "assessed": sid in levels,
        }
        for sid, required in profile["required_skills"].items()
    ]
    return sorted(rows, key=lambda r: (-r["critical"], -r["gap"], r["name"]))


def eligible(employee, levels, event, history, as_of):
    if (
        event["mandatory"]
        or employee["role"] not in event["target_roles"]
        or employee["grade"] not in event["target_grades"]
    ):
        return False
    if any(levels.get(sid, 0) < minimum for sid, minimum in event["prerequisites"].items()):
        return False
    if event["format"] != "self_paced" and not any(d >= as_of for d in event["upcoming_sessions"]):
        return False
    relevant = [
        r
        for r in history
        if r["employee_id"] == employee["employee_id"]
        and r["event_id"] == event["event_id"]
        and r["date"] <= as_of
    ]
    if any(r["status"] == "in_progress" for r in relevant):
        return False
    return event["event_id"] == "EV_036" or not any(r["status"] == "completed" for r in relevant)


# A skill with an expert-confirmed development area (work evidence) gets this multiplier.
FOCUS_WEIGHT = 2


def recommendations(employee, levels, gaps, events, history, as_of, pending=(), focus=()):
    if not employee.get("career_goal"):
        return []
    gap_map = {row["skill_id"]: row for row in gaps}
    ranked = []
    cutoff = (date.fromisoformat(as_of) - timedelta(days=180)).isoformat()
    for event in events.values():
        if event["event_id"] in pending or not eligible(employee, levels, event, history, as_of):
            continue
        improved = apply_gains(levels, event)
        benefits = []
        weighted = 0
        for sid, row in gap_map.items():
            delta = min(row["gap"], improved.get(sid, 0) - levels.get(sid, 0))
            if delta > 0:
                weighted += (
                    delta * (3 if row["critical"] else 1) * (FOCUS_WEIGHT if sid in focus else 1)
                )
                benefits.append(
                    {
                        "skill_id": sid,
                        "name": row["name"],
                        "from": levels.get(sid, 0),
                        "to": improved[sid],
                        "critical": row["critical"],
                        "evidence": sid in focus,
                    }
                )
        if not benefits:
            continue
        misses = sum(
            r["status"] in {"no_show", "declined", "dropped"}
            for r in history
            if r["employee_id"] == employee["employee_id"]
            and r["event_id"] == event["event_id"]
            and cutoff <= r["date"] <= as_of
        )
        # Similarity means shared developed skills, not merely delivery format.
        # This is a bounded history factor, never a judgment about motivation.
        developed = {b["skill_id"] for b in benefits}
        similar_ids = {
            other["event_id"]
            for other in events.values()
            if other["event_id"] != event["event_id"]
            and not other["mandatory"]
            and developed & {g["skill_id"] for g in other["develops_skills"]}
        }
        similar_misses = len(
            {
                r["record_id"]
                for r in history
                if r["employee_id"] == employee["employee_id"]
                and r["event_id"] in similar_ids
                and cutoff <= r["date"] <= as_of
                and r["status"] in {"no_show", "declined", "dropped"}
            }
        )
        score = (
            weighted
            / sqrt(max(event["duration_hours"], 1))
            / (1 + misses * 0.35 + min(similar_misses, 3) * 0.15)
        )
        ranked.append(
            {
                **event,
                "score": round(score, 4),
                "benefits": benefits,
                "past_misses": misses,
                "similar_misses": similar_misses,
                "next_session": next(
                    iter(sorted(d for d in event["upcoming_sessions"] if d >= as_of)), None
                ),
                "reason": (
                    f"Для цели {employee['career_goal']['target_grade']}: "
                    + ", ".join(b["name"] for b in benefits)
                    + f". Нагрузка — {event['duration_hours']} ч. "
                    + (
                        "Есть прирост критичных для роли навыков. "
                        if any(b["critical"] for b in benefits)
                        else "Закрывает дополнительные требования роли. "
                    )
                    + (
                        "Приоритет повышен: эксперт подтвердил по рабочим примерам зону развития — "
                        + ", ".join(b["name"] for b in benefits if b["evidence"])
                        + ". "
                        if any(b["evidence"] for b in benefits)
                        else ""
                    )
                    + (
                        f"Приоритет снижен с учётом {misses} отказов/пропусков за 180 дней."
                        if misses
                        else "За 180 дней нет отказов/пропусков этого мероприятия в истории."
                    )
                    + (
                        f" Учтены {similar_misses} отказа/пропуска других мероприятий по тем же навыкам за 180 дней; стоит уточнить удобный формат."
                        if similar_misses
                        else ""
                    )
                ),
            }
        )
    return sorted(ranked, key=lambda r: (-r["score"], r["event_id"]))[:3]


def readiness(gaps):
    total = sum(r["required"] for r in gaps)
    return (
        round(100 * sum(min(r["current"], r["required"]) for r in gaps) / total) if total else None
    )
