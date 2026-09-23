import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSearch,
  GitPullRequest,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, post } from "./api";
import type { EvidenceQueue, Observation, WorkEvidence } from "./types";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";
const sourceNames: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  confluence: "Confluence",
  jira: "Jira",
};
const outcomes: Record<string, string> = {
  open: "не исправлено",
  fixed: "исправлено после ревью",
};
const statusText: Record<Observation["status"], string> = {
  draft: "Черновик · не влияет на навыки",
  confirmed: "Подтверждено экспертом",
  rejected: "Отклонено экспертом",
};
const statusClass: Record<Observation["status"], string> = {
  draft: "pending",
  confirmed: "approved",
  rejected: "rejected",
};

export function WorkEvidencePanel({
  eid,
  isHR,
  onChanged,
}: {
  eid: string;
  isHR: boolean;
  onChanged: () => void;
}) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["evidence", eid],
    queryFn: () => api<WorkEvidence>(`/employees/${eid}/work-evidence`),
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  function refresh() {
    void cache.invalidateQueries({ queryKey: ["evidence", eid] });
    void cache.invalidateQueries({ queryKey: ["evidence-queue"] });
    onChanged();
  }
  async function analyze() {
    setBusy(true);
    setMessage("");
    try {
      const r = await post<{
        observations: number;
        updated: number;
        insufficient: number;
        message: string;
      }>(`/hr/work-evidence/${eid}/analyze`);
      setMessage(
        `Наблюдений: ${r.observations} (обновлено ${r.updated}), недостаточно сведений: ${r.insufficient}. ${r.message}.`,
      );
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending)
    return <div className="loading">Загружаем рабочие примеры…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const d = query.data;
  const empty = !d.artifacts.length && !d.tasks.length;
  return (
    <section className="panel evidence-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">
            РАБОЧИЕ ПРИМЕРЫ · СИНТЕТИЧЕСКИЕ ДАННЫЕ
          </span>
          <h2>Навыки по реальной работе</h2>
        </div>
        {isHR && (
          <button
            className="secondary"
            onClick={analyze}
            disabled={busy || empty}
          >
            <FileSearch size={16} />
            {busy ? "Анализируем…" : "Проанализировать"}
          </button>
        )}
      </div>
      <p className="muted">
        Правила ищут замечания, повторяющиеся минимум в двух независимых
        задачах. AI (если подключён) только формулирует вывод. Уровни навыков не
        меняются: подтверждённая экспертом зона развития повышает приоритет
        подходящих обучений.
      </p>
      {message && (
        <p className="mode-note" role="status">
          {message}
        </p>
      )}
      {empty && (
        <div className="empty">
          {isHR
            ? "Для сотрудника нет загруженных рабочих примеров. Импортируйте синтетический набор на экране команды."
            : "Рабочие примеры пока не загружены. Отсутствие данных не означает отсутствие работы."}
        </div>
      )}
      {d.focus.map((f) => (
        <div className="callout evidence-focus" key={f.skill_id}>
          <strong>{f.name}:</strong> {f.note}
          {f.courses.length > 0 && ` Подходит: ${f.courses.join(", ")}.`}
        </div>
      ))}
      {d.observations.map((o) => (
        <ObservationCard
          key={o.observation_id}
          eid={eid}
          obs={o}
          skill={d.skill_names[o.skill_id] ?? o.skill_id}
          isHR={isHR}
          saved={refresh}
        />
      ))}
      {!empty && !d.observations.length && (
        <div className="empty">
          {isHR
            ? "Наблюдений ещё нет. Нажмите «Проанализировать»."
            : "HR ещё не запускал анализ. Здесь появятся предварительные наблюдения, которые вы сможете прокомментировать."}
        </div>
      )}
      {d.insufficient.length > 0 && (
        <div className="evidence-block">
          <h3>Недостаточно сведений</h3>
          {d.insufficient.map((i) => (
            <p className="muted" key={`${i.criterion_id}-${i.kind}`}>
              {i.title} (
              {i.kind === "strength" ? "сильная сторона" : "зона развития"}) ·{" "}
              {i.tasks.join(", ")} — {i.reason} Вывод не делается.
            </p>
          ))}
        </div>
      )}
      {!empty && (
        <details className="evidence-block">
          <summary>
            Материалы: {d.artifacts.length} · задачи: {d.tasks.length}
          </summary>
          {d.artifacts.map((a) => (
            <div className="history-row" key={a.artifact_id}>
              <span className="history-icon">
                <GitPullRequest size={18} />
              </span>
              <div>
                <strong>{a.title}</strong>
                <small>
                  {sourceNames[a.source]} · {a.task_key} · версия {a.version} ·{" "}
                  {a.contribution === "author" ? "автор" : "соавтор"}
                  {a.shared ? " · совместная работа" : ""} · замечаний:{" "}
                  {a.findings}
                </small>
              </div>
            </div>
          ))}
          {d.tasks.map((t) => (
            <p className="muted" key={t.task_id}>
              {t.key} · {t.title}: оценка {t.estimate_hours ?? "—"} ч, записано{" "}
              {t.logged_hours} ч
              {t.blocked_hours
                ? `, ожидание ${t.blocked_hours} ч (не активная работа)`
                : ""}
            </p>
          ))}
          <p className="footnote">
            План/факт по времени — контекст для разговора, а не оценка навыка.
            {d.unmatched_artifacts
              ? ` В импорте ${d.unmatched_artifacts} материал(ов) без подтверждённой привязки автора — они не анализируются.`
              : ""}
          </p>
        </details>
      )}
    </section>
  );
}

function ObservationCard({
  eid,
  obs: o,
  skill,
  isHR,
  saved,
}: {
  eid: string;
  obs: Observation;
  skill: string;
  isHR: boolean;
  saved: () => void;
}) {
  const [comment, setComment] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const id = encodeURIComponent(o.observation_id);
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/employees/${eid}/observations/${id}/comments`, {
        text: comment,
      });
      setComment("");
      saved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision: "confirmed" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await post(`/hr/observations/${id}/review`, { decision, note });
      saved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`observation ${o.kind}`}>
      <header>
        <span className="badge">
          {o.kind === "development" ? "Зона развития" : "Сильная сторона"} ·{" "}
          {skill}
        </span>
        <span className={`status ${statusClass[o.status]}`}>
          {statusText[o.status]}
        </span>
      </header>
      <h3>{o.criterion_title}</h3>
      <p>{o.summary}</p>
      {o.summary_mode === "ai" && (
        <p className="muted">
          <Sparkles size={13} /> Формулировка AI. Альтернатива: {o.alternative}
        </p>
      )}
      <ul className="evidence-list">
        {o.evidence.map((e, i) => (
          <li key={`${e.artifact_id}-${e.finding_id ?? i}`}>
            <strong>{e.task_key}</strong> · {e.artifact_title} (
            {sourceNames[e.source]}, {e.version}){e.text && <> — «{e.text}»</>}
            {e.outcome && e.outcome !== "open" && (
              <em> {outcomes[e.outcome]}</em>
            )}
            {e.shared && <em> · совместная работа</em>}
          </li>
        ))}
      </ul>
      <ul className="limitations">
        {o.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {o.review && (
        <p className="review-note">
          <ShieldCheck size={14} /> {o.review.reviewer}: {o.review.note}
        </p>
      )}
      {o.comments.map((c) => (
        <blockquote key={c.at}>
          {c.role === "hr" ? "HR" : "Сотрудник"}: {c.text}
        </blockquote>
      ))}
      <form className="inline-form" onSubmit={send}>
        <input
          aria-label="Комментарий к наблюдению"
          placeholder={
            isHR
              ? "Комментарий эксперта"
              : "Добавить контекст или оспорить наблюдение"
          }
          value={comment}
          minLength={3}
          maxLength={1000}
          required
          onChange={(e) => setComment(e.target.value)}
        />
        <button className="secondary" disabled={busy}>
          Отправить
        </button>
      </form>
      {isHR && o.status === "draft" && (
        <div className="inline-form">
          <input
            aria-label="Основание решения"
            placeholder="Основание решения эксперта"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || note.trim().length < 3}
            onClick={() => decide("confirmed")}
          >
            Подтвердить
          </button>
          <button
            className="secondary"
            disabled={busy || note.trim().length < 3}
            onClick={() => decide("rejected")}
          >
            Отклонить
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

export function EvidenceHRPanel({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["evidence-queue"],
    queryFn: () => api<EvidenceQueue>("/hr/work-evidence/queue"),
  });
  const [file, setFile] = useState<File>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage("");
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api<{
        inserted: number;
        tasks: number;
        artifacts: number;
      }>("/hr/work-evidence/import", { method: "POST", body: form });
      setMessage(
        `Добавлено записей: ${r.inserted} (задач ${r.tasks}, материалов ${r.artifacts}). Откройте профиль и запустите анализ.`,
      );
      void cache.invalidateQueries({ queryKey: ["evidence"] });
      void cache.invalidateQueries({ queryKey: ["evidence-queue"] });
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Рабочие примеры</h2>
        <span className="badge">Синтетический импорт</span>
      </div>
      <form className="inline-form" onSubmit={submit}>
        <input
          type="file"
          accept=".json"
          aria-label="Файл рабочих примеров"
          onChange={(e) => setFile(e.target.files?.[0])}
        />
        <button className="secondary" disabled={busy || !file}>
          {busy ? "Проверяем…" : "Импортировать"}
        </button>
      </form>
      <p className="muted">
        Формат — demo/work_evidence_synthetic.json: задачи Jira, PR GitHub,
        страницы Confluence и подтверждённые привязки аккаунтов. Принимаются
        только файлы с meta.synthetic = true.
      </p>
      {message && <p role="status">{message}</p>}
      {q.data && q.data.drafts.length > 0 && (
        <>
          <h3>Ожидают решения эксперта</h3>
          {q.data.drafts.map((o) => (
            <div className="history-row" key={o.observation_id}>
              <span className="history-icon">
                <FileSearch size={18} />
              </span>
              <div>
                <strong>
                  {o.full_name} · {o.criterion_title}
                </strong>
                <small>
                  {o.kind === "development"
                    ? "Зона развития"
                    : "Сильная сторона"}{" "}
                  · {o.task_keys.join(", ")}
                </small>
              </div>
              <button
                className="secondary"
                onClick={() => onSelect(o.employee_id)}
              >
                Открыть
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
