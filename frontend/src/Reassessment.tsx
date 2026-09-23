import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "./api";
import type { Catalog, Profile, Reassessment } from "./types";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";
const dateText = (value: string) =>
  new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const methods: Record<string, string> = {
  interview: "Интервью",
  practical_task: "Практическое задание",
  portfolio: "Портфолио",
  combined: "Комбинированно",
};
const statusText: Record<Reassessment["status"], string> = {
  proposed: "Ждёт подтверждения",
  confirmed: "Подтверждена",
  rejected: "Отклонена",
};

export function ReassessmentPanel({
  profile,
  catalog,
  isHR,
  username,
  onChanged,
}: {
  profile: Profile;
  catalog: Catalog;
  isHR: boolean;
  username: string;
  onChanged: () => void;
}) {
  const eid = profile.employee.employee_id;
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["reassessments", eid],
    queryFn: () => api<Reassessment[]>(`/employees/${eid}/reassessments`),
  });
  const [open, setOpen] = useState(false),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [message, setMessage] = useState("");
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["reassessments", eid] });
    onChanged();
  };
  async function decide(r: Reassessment, decision: "confirmed" | "rejected") {
    setMessage("");
    try {
      await post(`/hr/reassessments/${r.reassessment_id}/decision`, {
        decision,
        note: notes[r.reassessment_id],
      });
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  if (profile.onboarding?.status === "pending_assessment") return null;
  const rows = q.data ?? [];
  const pending = rows.some((r) => r.status === "proposed");
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>Повторная аттестация</h2>
          <p className="muted">
            Новая оценка с основаниями и автором. Исходная оценка не
            перезаписывается; уровни меняются только после подтверждения другим
            HR-экспертом.
          </p>
        </div>
        {isHR && !pending && (
          <button className="secondary" onClick={() => setOpen(!open)}>
            {open ? "Скрыть форму" : "Провести аттестацию"}
          </button>
        )}
      </div>
      {open && (
        <ReassessmentForm
          profile={profile}
          catalog={catalog}
          saved={() => {
            setOpen(false);
            refresh();
          }}
        />
      )}
      {message && <p className="error">{message}</p>}
      {!rows.length && !open && (
        <p className="muted">
          Последняя оценка: {dateText(profile.employee.last_review_date)}.
          Повторных аттестаций пока не было.
        </p>
      )}
      {rows.map((r) => (
        <div className="reassessment" key={r.reassessment_id}>
          <div className="panel-title">
            <strong>
              {dateText(r.assessed_on)} · {methods[r.method] ?? r.method}
            </strong>
            <span
              className={`status ${r.status === "confirmed" ? "approved" : r.status === "rejected" ? "rejected" : "pending"}`}
            >
              {statusText[r.status]}
            </span>
          </div>
          <small className="muted">
            Провёл {r.proposed_by}
            {r.decided_by ? ` · решение ${r.decided_by}` : ""} · предыдущая
            оценка {dateText(r.previous_review_date)}
          </small>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Навык</th>
                  <th>Было</th>
                  <th>Стало</th>
                  <th>Изменение</th>
                  {r.comparison.some((c) => c.evidence) && <th>Основание</th>}
                </tr>
              </thead>
              <tbody>
                {r.comparison.map((c) => (
                  <tr key={c.skill_id}>
                    <td>{c.name}</td>
                    <td>{c.before}</td>
                    <td>{c.after}</td>
                    <td className={c.delta < 0 ? "delta-down" : "delta-up"}>
                      {c.delta > 0 ? `+${c.delta}` : c.delta}
                    </td>
                    {c.evidence && <td>{c.evidence}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.note && <p className="muted">{r.note}</p>}
          {r.decision_note && (
            <p className="muted">Комментарий решения: {r.decision_note}</p>
          )}
          {isHR &&
            r.status === "proposed" &&
            (r.proposed_by === username ? (
              <p className="muted">
                Подтверждает другой HR-эксперт (например, expert).
              </p>
            ) : (
              <div className="button-group">
                <input
                  aria-label="Комментарий решения"
                  placeholder="Комментарий к решению"
                  value={notes[r.reassessment_id] ?? ""}
                  onChange={(e) =>
                    setNotes({ ...notes, [r.reassessment_id]: e.target.value })
                  }
                />
                <button
                  className="primary"
                  disabled={(notes[r.reassessment_id] ?? "").length < 3}
                  onClick={() => decide(r, "confirmed")}
                >
                  Подтвердить
                </button>
                <button
                  className="secondary"
                  disabled={(notes[r.reassessment_id] ?? "").length < 3}
                  onClick={() => decide(r, "rejected")}
                >
                  Отклонить
                </button>
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}

function ReassessmentForm({
  profile,
  catalog,
  saved,
}: {
  profile: Profile;
  catalog: Catalog;
  saved: () => void;
}) {
  const defaults = profile.gaps
    .filter((g) => g.gap > 0)
    .slice(0, 3)
    .map((g) => g.skill_id);
  const [when, setWhen] = useState(profile.as_of),
    [method, setMethod] = useState("practical_task"),
    [note, setNote] = useState(""),
    [rows, setRows] = useState(
      (defaults.length ? defaults : [catalog.skills[0].skill_id]).map((s) => ({
        skill_id: s,
        level: profile.levels[s] ?? 0,
        evidence: "",
      })),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(
        `/hr/employees/${profile.employee.employee_id}/reassessments`,
        {
          assessed_on: when,
          method,
          ratings: rows,
          note,
        },
      );
      saved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="course-form" onSubmit={submit}>
      <div className="form-row">
        <label>
          Дата аттестации
          <input
            type="date"
            value={when}
            min={profile.employee.last_review_date}
            max={profile.as_of}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </label>
        <label>
          Метод
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(methods).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.map((r, i) => (
        <div className="form-row" key={i}>
          <select
            aria-label="Навык"
            value={r.skill_id}
            onChange={(e) =>
              update(i, {
                skill_id: e.target.value,
                level: profile.levels[e.target.value] ?? 0,
              })
            }
          >
            {catalog.skills.map((s) => (
              <option key={s.skill_id} value={s.skill_id}>
                {s.name}
              </option>
            ))}
          </select>
          <label>
            Уровень (сейчас {profile.levels[r.skill_id] ?? 0})
            <select
              value={r.level}
              onChange={(e) => update(i, { level: Number(e.target.value) })}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <input
            aria-label="Основание"
            placeholder="Основание: что показал сотрудник"
            value={r.evidence}
            onChange={(e) => update(i, { evidence: e.target.value })}
            minLength={8}
            required
          />
          {rows.length > 1 && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              Убрать
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() =>
          setRows([
            ...rows,
            { skill_id: catalog.skills[0].skill_id, level: 0, evidence: "" },
          ])
        }
      >
        + Навык
      </button>
      <label>
        Итоговый комментарий
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          minLength={8}
          maxLength={1500}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        {busy ? "Сохраняем…" : "Отправить на подтверждение"}
      </button>
    </form>
  );
}
