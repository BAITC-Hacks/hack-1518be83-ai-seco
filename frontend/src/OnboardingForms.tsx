import { useState } from "react";
import type { FormEvent } from "react";
import { post } from "./api";
import type { Catalog, Profile } from "./types";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось сохранить данные";

type Created = {
  employee_id: string;
  access: { username: string; password: string } | null;
};

export function CreateEmployeeForm({
  catalog,
  saved,
  openProfile,
}: {
  catalog: Catalog;
  saved: () => void;
  openProfile: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Created | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const created = await post<Created>("/hr/onboarding", {
        employee_id: value("employee_id"),
        full_name: value("full_name"),
        department: value("department"),
        role: value("role"),
        grade: value("grade"),
        specialization: value("specialization"),
        hire_date: value("hire_date"),
        grade_since: value("grade_since") || null,
        manager_id: value("manager_id") || null,
        work_format: value("work_format"),
        preferred_language: value("preferred_language"),
        create_account: data.has("create_account"),
      });
      setResult(created);
      saved();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <div className="onboarding-result" role="status">
        <h3>Профиль {result.employee_id} создан</h3>
        <p>
          Следующий шаг — первичная оценка навыков. Цель и рекомендации появятся
          после оценки HR.
        </p>
        {result.access ? (
          <div className="callout">
            <strong>Доступ сотрудника · только для локального демо</strong>
            <p>
              Пароль показан один раз. Сохраните его в безопасном месте до
              закрытия окна, не публикуйте в Git или общем чате.
            </p>
            <label>
              Логин сотрудника
              <input
                readOnly
                value={result.access.username}
                autoComplete="off"
              />
            </label>
            <label>
              Пароль сотрудника
              <input
                readOnly
                value={result.access.password}
                autoComplete="off"
              />
            </label>
            <p>
              На экране входа выберите «Сотрудник» и введите эти данные.
              Корпоративный вход и смена пароля пока не реализованы.
            </p>
          </div>
        ) : (
          <p>
            Аккаунт не создавался. Профиль доступен HR; вход сотрудника требует
            отдельного аккаунта.
          </p>
        )}
        <button
          className="primary full"
          onClick={() => openProfile(result.employee_id)}
        >
          К первичной оценке
        </button>
      </div>
    );
  return (
    <>
      <p>
        1. Профиль → 2. Оценка навыков → 3. Цель от HR. В локальном демо
        используйте только синтетические данные.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="plain-fieldset">
          <div className="form-grid">
            <label>
              ID сотрудника
              <input
                name="employee_id"
                placeholder="E0201"
                pattern="[A-Za-z0-9_-]{1,50}"
                maxLength={50}
                required
              />
            </label>
            <label>
              Имя синтетического сотрудника
              <input name="full_name" maxLength={150} required />
            </label>
            <label>
              Подразделение
              <input name="department" maxLength={100} required />
            </label>
            <label>
              Специализация
              <input
                name="specialization"
                placeholder="Например, Java / Spring"
                maxLength={100}
              />
            </label>
            <label>
              Роль
              <select name="role" defaultValue={catalog.profiles[0].role}>
                {[...new Set(catalog.profiles.map((p) => p.role))].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              Текущий грейд
              <select name="grade" defaultValue="Junior">
                {["Junior", "Middle", "Senior", "Lead"].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
            <label>
              Дата найма
              <input
                name="hire_date"
                type="date"
                max={catalog.as_of}
                required
              />
            </label>
            <label>
              На текущем грейде с
              <input name="grade_since" type="date" max={catalog.as_of} />
              <small>
                Если неизвестно, оставьте пустым. Стаж не подменяет эту дату.
              </small>
            </label>
            <label>
              Формат работы
              <select name="work_format" defaultValue="hybrid">
                <option value="hybrid">Гибридный</option>
                <option value="office">Офис</option>
                <option value="remote">Удалённый</option>
              </select>
            </label>
            <label>
              Предпочитаемый язык
              <select name="preferred_language" defaultValue="ru">
                <option value="ru">Русский</option>
                <option value="kk">Казахский</option>
                <option value="en">Английский</option>
              </select>
              <small>
                Предпочтение сохраняется; интерфейс пока русскоязычный.
              </small>
            </label>
            <label>
              ID руководителя
              <input
                name="manager_id"
                maxLength={50}
                placeholder="Необязательно"
              />
            </label>
          </div>
          <label className="checkbox-line">
            <input type="checkbox" name="create_account" />
            Создать отдельный вход сотруднику
          </label>
          <p className="muted">
            Роль, грейд и специализация сами по себе не задают оценки навыков.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "Создаём…" : "Создать профиль"}
          </button>
        </fieldset>
      </form>
    </>
  );
}

const levels = [
  "0 — нет знаний (подтверждено)",
  "1 — базовые понятия, нужна помощь",
  "2 — типовые задачи с поддержкой",
  "3 — самостоятельная работа",
  "4 — сложные задачи, помощь коллегам",
  "5 — эксперт, формирует стандарты",
];

export function AssessmentForm({
  profile,
  catalog,
  saved,
}: {
  profile: Profile;
  catalog: Catalog;
  saved: () => void;
}) {
  const [ratings, setRatings] = useState<
    Record<string, { level: string; evidence: string }>
  >({});
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matrix = catalog.profiles.find(
    (p) =>
      p.role === profile.employee.role && p.grade === profile.employee.grade,
  );
  const currentSkills = new Set(Object.keys(matrix?.required_skills ?? {}));
  const visible = catalog.skills.filter(
    (s) =>
      showAll || currentSkills.has(s.skill_id) || ratings[s.skill_id]?.level,
  );
  const assessed = Object.entries(ratings).filter(([, r]) => r.level !== "");
  function update(
    id: string,
    patch: Partial<{ level: string; evidence: string }>,
  ) {
    setRatings((previous) => ({
      ...previous,
      [id]: { ...(previous[id] ?? { level: "", evidence: "" }), ...patch },
    }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await post(
        `/hr/employees/${profile.employee.employee_id}/initial-assessment`,
        {
          assessed_on: form.get("assessed_on"),
          method: form.get("method"),
          note: form.get("note"),
          ratings: assessed.map(([skill_id, rating]) => ({
            skill_id,
            level: Number(rating.level),
            evidence: rating.evidence.trim(),
          })),
        },
      );
      saved();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        {profile.employee.full_name} · {profile.employee.role} /{" "}
        {profile.employee.grade}
      </p>
      <div className="callout">
        HR фиксирует результаты интервью или практики. «Не оценён» — отсутствие
        данных, а 0 — подтверждённое отсутствие знаний. LLM не выставляет
        оценки. Запись первичной оценки сохраняется с автором и основаниями;
        повторная аттестация — отдельный будущий процесс.
      </div>
      <form onSubmit={submit}>
        <fieldset className="plain-fieldset" disabled={busy}>
          <div className="form-grid">
            <label>
              Дата оценки
              <input
                name="assessed_on"
                type="date"
                min={profile.employee.hire_date}
                max={profile.as_of}
                defaultValue={profile.as_of}
                required
              />
            </label>
            <label>
              Способ оценки
              <select name="method" defaultValue="practical_task">
                <option value="practical_task">Практическое задание</option>
                <option value="interview">Структурированное интервью</option>
                <option value="portfolio">Рабочие примеры / портфолио</option>
                <option value="combined">Несколько источников</option>
              </select>
            </label>
          </div>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Показать навыки всего каталога
          </label>
          <p className="muted">
            По умолчанию — матрица текущей роли и грейда. Для специализации
            можно добавить другие навыки из каталога.
          </p>
          <div className="assessment-fields">
            {visible.map((skill) => (
              <div className="assessment-field" key={skill.skill_id}>
                <label>
                  {skill.name} — уровень
                  <select
                    aria-label={`${skill.name} — уровень`}
                    value={ratings[skill.skill_id]?.level ?? ""}
                    onChange={(e) =>
                      update(skill.skill_id, { level: e.target.value })
                    }
                  >
                    <option value="">Не оценён</option>
                    {levels.map((label, level) => (
                      <option value={String(level)} key={level}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {ratings[skill.skill_id]?.level !== undefined &&
                  ratings[skill.skill_id].level !== "" && (
                    <label>
                      {skill.name} — основание
                      <textarea
                        aria-label={`${skill.name} — основание`}
                        value={ratings[skill.skill_id].evidence}
                        onChange={(e) =>
                          update(skill.skill_id, { evidence: e.target.value })
                        }
                        placeholder="Какое задание или рабочий пример подтверждает уровень?"
                        minLength={8}
                        maxLength={1000}
                        required
                      />
                    </label>
                  )}
              </div>
            ))}
          </div>
          <label>
            Итог оценки
            <textarea
              name="note"
              minLength={8}
              maxLength={1500}
              placeholder="Контекст оценки, ограничения и что ещё нужно проверить"
              required
            />
          </label>
          <p className="muted">
            Оценено навыков: {assessed.length}. Неоценённые навыки останутся
            неизвестными. Частичная оценка допускается; рекомендации опираются
            только на оценённые навыки.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary full"
            disabled={busy || assessed.length === 0}
          >
            {busy ? "Сохраняем…" : "Подтвердить первичную оценку"}
          </button>
        </fieldset>
      </form>
    </>
  );
}
