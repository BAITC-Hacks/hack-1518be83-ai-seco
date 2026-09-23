import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import type { Profile, SupportPolicy } from "./types";

export const planLabels: Record<string, string> = {
  discussion: "Нужно обсудить",
  active: "План согласован",
  paused: "Согласованная пауза",
  closed: "Рассмотрение завершено",
};
const dateText = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("ru-RU");

export function DevelopmentPanel({
  profile: p,
  editable,
  onSaved,
}: {
  profile: Profile;
  editable: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const plan = p.development_plan;
  async function save(
    e: FormEvent<HTMLFormElement>,
    kind: "development-plan" | "grade-period",
  ) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const body =
      kind === "development-plan"
        ? {
            status: value("status"),
            owner: value("owner"),
            next_review_on: value("next_review_on") || null,
            note: value("note"),
            revision: plan?.revision ?? 0,
          }
        : {
            grade_since: value("grade_since"),
            note: value("note"),
            revision: p.grade_record.revision,
          };
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      await api(`/hr/employees/${p.employee.employee_id}/${kind}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setMessage(
        kind === "development-plan"
          ? "План сохранён. Очередь поддержки пересчитана."
          : "Дата грейда сохранена. Роль, грейд и навыки не изменены.",
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy("");
    }
  }
  if (!editable && !plan) return null;
  return (
    <section className="panel development-panel">
      <div className="panel-title">
        <h2>Договорённости о развитии</h2>
        <span className="badge">Решения принимает человек</span>
      </div>
      {plan ? (
        <div className="plan-summary">
          <strong>{planLabels[plan.status]}</strong>
          <p>{plan.note}</p>
          <small>
            Ответственный: {plan.owner} · Следующая встреча:{" "}
            {plan.next_review_on
              ? dateText(plan.next_review_on)
              : "не назначена"}
          </small>
        </div>
      ) : (
        <p className="muted">
          План пока не зафиксирован. HR может согласовать следующий шаг или
          паузу с сотрудником.
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editable && (
        <div className="development-editors">
          <details>
            <summary>Изменить план и следующую встречу</summary>
            <form
              key={plan?.revision ?? 0}
              onSubmit={(e) => save(e, "development-plan")}
            >
              <label>
                Статус плана
                <select
                  name="status"
                  defaultValue={plan?.status ?? "discussion"}
                >
                  {Object.entries(planLabels).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ответственный HR (логин)
                <input
                  name="owner"
                  defaultValue={plan?.owner ?? "hr"}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Следующая встреча
                <input
                  name="next_review_on"
                  type="date"
                  min={p.as_of}
                  defaultValue={plan?.next_review_on ?? ""}
                />
              </label>
              <small>
                Для открытого плана или паузы дата обязательна. Используется
                срез демо {dateText(p.as_of)}.
              </small>
              <label>
                Согласованный шаг или причина паузы
                <textarea
                  name="note"
                  defaultValue={plan?.note ?? ""}
                  minLength={8}
                  maxLength={1500}
                  required
                />
              </label>
              <small>
                Текст видят сотрудник и руководитель его отдела. Не добавляйте
                конфиденциальные HR-заметки или сведения о здоровье.
              </small>
              <button className="primary" disabled={!!busy}>
                {busy === "development-plan" ? "Сохраняем…" : "Сохранить план"}
              </button>
            </form>
          </details>
          <details>
            <summary>Уточнить дату текущего грейда</summary>
            <p className="muted">
              Не является повышением. Указывайте подтверждённую дату, не стаж
              работы в компании.
            </p>
            <form
              key={p.grade_record.revision}
              onSubmit={(e) => save(e, "grade-period")}
            >
              <label>
                На текущем грейде с
                <input
                  name="grade_since"
                  type="date"
                  min={p.employee.hire_date}
                  max={p.as_of}
                  defaultValue={p.grade_since ?? ""}
                  required
                />
              </label>
              <label>
                Основание даты
                <textarea name="note" minLength={8} maxLength={1000} required />
              </label>
              <button className="secondary" disabled={!!busy}>
                {busy === "grade-period"
                  ? "Сохраняем…"
                  : "Сохранить дату грейда"}
              </button>
            </form>
            {p.grade_record.history.length > 0 && (
              <div className="period-history">
                <h3>История уточнений</h3>
                {[...p.grade_record.history].reverse().map((r, i) => (
                  <p key={i}>
                    <strong>{dateText(r.grade_since)}</strong> · {r.reviewer}
                    <br />
                    {r.note}
                  </p>
                ))}
              </div>
            )}
          </details>
        </div>
      )}
    </section>
  );
}

export function PolicyForm({
  policy,
  onSaved,
}: {
  policy: SupportPolicy;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api("/hr/support-policy", {
        method: "PUT",
        body: JSON.stringify({
          inactivity_days: Number(form.get("inactivity_days")),
          grade_months: Number(form.get("grade_months")),
          misses: Number(form.get("misses")),
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <p>
        Пороги — повод предложить помощь, а не оценка личности. Согласованная
        пауза откладывает сигналы активности до следующего рассмотрения.
      </p>
      <label>
        Период без записей о развитии, дней
        <input
          type="number"
          name="inactivity_days"
          min={30}
          max={730}
          defaultValue={policy.inactivity_days}
          required
        />
      </label>
      <label>
        Срок на одном грейде, месяцев
        <input
          type="number"
          name="grade_months"
          min={3}
          max={120}
          defaultValue={policy.grade_months}
          required
        />
      </label>
      <label>
        Неявок за выбранный период
        <input
          type="number"
          name="misses"
          min={1}
          max={20}
          defaultValue={policy.misses}
          required
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить пороги"}
      </button>
    </form>
  );
}

export function LearningPanel({
  profile: p,
  onComplete,
}: {
  profile: Profile;
  onComplete: (event: { event_id: string; title: string }) => void;
}) {
  const [filter, setFilter] = useState("active");
  const latest = new Map<string, Profile["history"][number]>();
  for (const row of [...p.history].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.record_id.localeCompare(b.record_id),
  ))
    latest.set(row.event_id, row);
  const active = [...latest.values()].filter(
    (r) =>
      r.status !== "completed" && (r.mandatory || r.status === "in_progress"),
  );
  const rows =
    filter === "active"
      ? active
      : p.history.filter((r) => r.status === "completed");
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Моё обучение</h2>
        <div className="button-group">
          <button
            className={filter === "active" ? "primary" : "secondary"}
            onClick={() => setFilter("active")}
          >
            К завершению · {active.length}
          </button>
          <button
            className={filter === "completed" ? "primary" : "secondary"}
            onClick={() => setFilter("completed")}
          >
            Пройдено
          </button>
        </div>
      </div>
      <p className="muted">
        Обязательные назначения отделены от добровольного развития. За них не
        начисляются игровые награды.
      </p>
      {!rows.length && (
        <p className="empty">В этой категории пока нет записей.</p>
      )}
      {rows.map((row) => (
        <div className="learning-item" key={row.record_id}>
          <div>
            <h3>{row.title}</h3>
            <span className="badge">
              {row.mandatory
                ? "Обязательное назначение"
                : "Добровольное развитие"}
            </span>
            <p>
              {row.status === "completed"
                ? "Завершено"
                : row.status === "in_progress"
                  ? `В процессе · ${row.completion_pct}%`
                  : "Нужно уточнить статус"}
              {row.due_date && ` · Срок: ${dateText(row.due_date)}`}
            </p>
          </div>
          {row.status === "in_progress" && !row.mandatory && (
            <button className="secondary" onClick={() => onComplete(row)}>
              Сообщить о завершении
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
