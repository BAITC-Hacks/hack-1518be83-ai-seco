"""Synthetic GitHub and Jira activity. Nothing here calls a real service.

Records are generated deterministically from the employee ID, so imported jury profiles get
stable demo activity without extra files. Jira is available to everyone; GitHub only to
people who have an account (an explicit `github_login` in the profile, otherwise most
engineers and QA and part of analysts; sales, support, HR and product have none).
Absence of activity never counts as absence of a skill.
"""

import hashlib
import random

PERIOD = ("2026-07-01", "2026-09-30")
PERIOD_LABEL = "01.07–30.09.2026"
SOURCES = ("github", "jira")
# Employees whose demo sources are connected on first start (same list as the static mockup).
DEMO_SEEDS = [
    "E0001", "E0002", "E0003", "E0004", "E0005", "E0006", "E0007",
    "E0008", "E0009", "E0011", "E0012", "E0014", "E0015", "E0028",
]  # fmt: skip

TEMPLATES = {
    "Backend Engineer": {
        "skill": "SK_API_DESIGN",
        "repo": "demo/payment-api",
        "project": "DEMO-BE",
        "title": "Контракт API платежей",
        "github": [
            "В ревью попросили описать единый формат ошибок и поведение повторного запроса.",
            "Перед слиянием добавлены контрактные тесты после обсуждения с ревьюером.",
        ],
        "jira": [
            "При приёмке уточняли сценарий повторной отправки платежа и коды ответов.",
            "В критерии готовности добавили описание обратной совместимости.",
        ],
        "practice": "Совместно с наставником спроектировать небольшой API и разобрать контракт на ревью.",
    },
    "Frontend Engineer": {
        "skill": "SK_ACCESSIBILITY",
        "repo": "demo/customer-portal",
        "project": "DEMO-WEB",
        "title": "Доступность формы перевода",
        "github": [
            "Ревьюер указал на потерю фокуса при закрытии диалога.",
            "В тестах формы попросили добавить сценарий управления с клавиатуры.",
        ],
        "jira": [
            "При приёмке форму нельзя было полностью пройти без мыши.",
            "Критерии готовности дополнили проверкой подписей полей для скринридера.",
        ],
        "practice": "Пройти форму с клавиатурой вместе с наставником и добавить проверки доступности.",
    },
    "Data Analyst": {
        "skill": "SK_AB_TESTING",
        "repo": "demo/analytics-notebooks",
        "project": "DEMO-DATA",
        "title": "Анализ эксперимента онбординга",
        "github": [
            "В ревью ноутбука попросили обосновать размер выборки.",
            "В расчёт после обсуждения добавили доверительный интервал.",
        ],
        "jira": [
            "На разборе результатов уточняли критерий остановки эксперимента.",
            "К описанию анализа попросили добавить ограничения причинного вывода.",
        ],
        "practice": "Разобрать дизайн эксперимента с аналитиком-наставником до его запуска.",
    },
    "QA Engineer": {
        "skill": "SK_TEST_DESIGN",
        "repo": "demo/qa-scenarios",
        "project": "DEMO-QA",
        "title": "Проверка лимитов переводов",
        "github": [
            "На ревью тестов предложили добавить граничные значения.",
            "Ревьюер попросил связать набор проверок с рисками требований.",
        ],
        "jira": [
            "При приёмке обнаружили неописанный сценарий превышения лимита.",
            "Матрицу тестов дополнили негативными сценариями.",
        ],
        "practice": "Составить таблицу граничных значений и обсудить покрытие с QA-наставником.",
    },
    "Customer Support Specialist": {
        "skill": "SK_TROUBLESHOOTING",
        "repo": "demo/support-playbooks",
        "project": "DEMO-SUPPORT",
        "title": "Диагностика ошибки входа",
        "github": ["В ревью инструкции попросили описать порядок диагностических шагов."],
        "jira": [
            "В разборе обращения наставник дополнил шаги воспроизведения ошибки.",
            "Перед эскалацией запросили диагностические данные по чек-листу.",
        ],
        "practice": "Разобрать несколько обращений с наставником и составить диагностический чек-лист.",
    },
    "Sales Manager": {
        "skill": "SK_ACCOUNT_MGMT",
        "repo": "demo/account-playbooks",
        "project": "DEMO-SALES",
        "title": "План сопровождения клиента",
        "github": ["В ревью плана попросили уточнить следующий шаг сопровождения."],
        "jira": [
            "При разборе кейса запросили карту участников со стороны клиента.",
            "План сопровождения дополнили контрольными точками после обсуждения.",
        ],
        "practice": "Подготовить план развития клиента и обсудить его с наставником.",
    },
    "HR Business Partner": {
        "skill": "SK_LEARNING_DESIGN",
        "repo": "demo/learning-materials",
        "project": "DEMO-HR",
        "title": "Программа адаптации",
        "github": ["В ревью программы попросили связать упражнения с целями обучения."],
        "jira": [
            "На разборе программы уточняли, как проверять освоение навыков.",
            "Критерии окончания адаптации дополнили практическим заданием.",
        ],
        "practice": "Разработать короткий учебный модуль с измеримым результатом и проверкой.",
    },
}
FALLBACK = {
    "skill": "SK_WRITTEN_COMMUNICATION",
    "repo": "demo/team-docs",
    "project": "DEMO-TEAM",
    "title": "Описание рабочего решения",
    "github": ["В ревью документа попросили чётко отделить решение от предположений."],
    "jira": [
        "В обсуждении задачи запросили однозначные критерии готовности.",
        "Описание дополнили примерами после уточняющих вопросов.",
    ],
    "practice": "Переписать описание задачи по шаблону и получить обратную связь коллеги.",
}
GITHUB_SHARE = {
    "Backend Engineer": 0.95,
    "Frontend Engineer": 0.95,
    "QA Engineer": 0.8,
    "Data Analyst": 0.5,
}
ISSUE_TYPES = ["Задача", "История", "Ошибка", "Улучшение"]


def rng(employee_id, salt):
    return random.Random(int(hashlib.sha256(f"{employee_id}:{salt}".encode()).hexdigest()[:12], 16))


def template(employee):
    return TEMPLATES.get(employee["role"], FALLBACK)


def github_login(employee):
    """An explicit `github_login` wins; otherwise a stable synthetic rule by role."""
    if employee.get("github_login"):
        return employee["github_login"]
    share = GITHUB_SHARE.get(employee["role"], 0)
    if rng(employee["employee_id"], "github-account").random() >= share:
        return None
    return employee["full_name"].lower().replace(" ", "-") + "-" + employee["employee_id"][-3:]


def available(employee, source):
    return source == "jira" or github_login(employee) is not None


def resources(employee, source):
    t = template(employee)
    return (
        [t["repo"], t["repo"] + "-docs"]
        if source == "github"
        else [t["project"], t["project"] + "-PRACTICE"]
    )


def _date(r):
    return f"2026-{r.choice(['07', '08', '09'])}-{r.randint(1, 28):02d}"


def activity(employee, source, chosen, role_skills):
    """Quantitative demo records for the selected resources. `role_skills` tags the work."""
    eid, t = employee["employee_id"], template(employee)
    skills = list(role_skills) or [t["skill"]]
    records = []
    for index, resource in enumerate(chosen):
        r = rng(eid, f"{source}:{resource}")
        for i in range(r.randint(4, 8)):
            skill = t["skill"] if i < 2 else r.choice(skills)
            if source == "jira":
                records.append(
                    {
                        "id": f"{resource}-{100 + index * 40 + i}",
                        "kind": r.choice(ISSUE_TYPES),
                        "story_points": r.choice([1, 2, 3, 5, 5, 8]),
                        "status": "done" if r.random() < 0.85 else "in_progress",
                        "date": _date(r),
                        "skill_id": skill,
                        "resource": resource,
                    }
                )
            else:
                records.append(
                    {
                        "id": f"PR #{100 + int(eid[-3:]) * 3 + index * 20 + i}",
                        "kind": "Pull request",
                        "reviews": r.randint(0, 4),
                        "comments": r.randint(0, 6),
                        "status": "merged" if r.random() < 0.9 else "open",
                        "date": _date(r),
                        "skill_id": skill,
                        "resource": resource,
                    }
                )
    return sorted(records, key=lambda x: x["date"])


def episodes(employee, source, chosen):
    """Review remarks and acceptance notes: the qualitative part HR reads."""
    t = template(employee)
    eid = int(employee["employee_id"][-3:]) if employee["employee_id"][-3:].isdigit() else 0
    return [
        {
            "source": source,
            "resource": resource,
            "skill_id": t["skill"],
            "title": t["title"],
            "note": note,
            "date": f"2026-09-{12 + r * 5 + i * 3:02d}",
            "id": f"PR #{120 + eid * 3 + r * 2 + i}"
            if source == "github"
            else f"{resource}-{200 + eid * 3 + r * 2 + i}",
        }
        for r, resource in enumerate(chosen)
        for i, note in enumerate(t[source])
    ]


def digest(employee, connections, gaps, skill_names, role_skills):
    """Summary per connected source plus one hypothesis for HR. Never changes skill levels."""
    t = template(employee)
    sources, evidence = {}, []
    for source in SOURCES:
        connection = connections.get(source)
        if not available(employee, source):
            sources[source] = {"status": "no_account"}
            continue
        if not connection:
            sources[source] = {"status": "not_connected"}
            continue
        records = activity(employee, source, connection["resources"], role_skills)
        found = episodes(employee, source, connection["resources"])
        evidence += found
        tags = {}
        for rec in records:
            tags[rec["skill_id"]] = tags.get(rec["skill_id"], 0) + 1
        top = sorted(tags.items(), key=lambda x: -x[1])[:3]
        summary = (
            {
                "items": len(records),
                "done": sum(rec["status"] == "done" for rec in records),
                "story_points": sum(
                    rec["story_points"] for rec in records if rec["status"] == "done"
                ),
            }
            if source == "jira"
            else {
                "items": len(records),
                "merged": sum(rec["status"] == "merged" for rec in records),
                "reviews": sum(rec["reviews"] for rec in records),
            }
        )
        sources[source] = {
            "status": "connected",
            "login": github_login(employee)
            if source == "github"
            else employee["employee_id"].lower(),
            "resources": connection["resources"],
            "synced_at": connection["synced_at"],
            "summary": summary,
            "top_skills": [
                {"name": skill_names.get(k, {}).get("name", k), "count": c} for k, c in top
            ],
            "records": records[-6:],
        }
    signal = None
    if evidence:
        gap = next((g for g in gaps if g["skill_id"] == t["skill"]), None)
        skill = skill_names.get(t["skill"], {}).get("name", t["skill"])
        sufficient = len(evidence) >= 2
        if not sufficient:
            title = "Недостаточно данных для вывода"
            text = "Один эпизод не позволяет оценить навык. Нужны другие примеры и разговор с сотрудником."
        elif gap and gap["gap"] > 0:
            title = f"Возможная зона роста: {skill}"
            text = (
                f"Замечания в рабочих эпизодах совпадают с разрывом в матрице: {gap['current']} из "
                f"{gap['required']}. Это повод обсудить развитие, не доказательство дефицита."
            )
        else:
            title = f"Стоит уточнить практику: {skill}"
            text = "Есть замечания к отдельным рабочим эпизодам. Они не доказывают пробел в навыке и не меняют оценку."
        signal = {
            "title": title,
            "text": text,
            "skill": skill,
            "skill_id": t["skill"],
            "sufficient": sufficient,
            "practice": t["practice"],
            "evidence": evidence,
            "period": PERIOD_LABEL,
        }
    return {"sources": sources, "signal": signal}
