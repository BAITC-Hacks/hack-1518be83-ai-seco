import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { api, post } from "./api";
import type { Catalog, RewardClaim, RewardItem } from "./types";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";
export const claimStatus: Record<RewardClaim["status"], string> = {
  pending: "На рассмотрении HR",
  approved: "Одобрена, ждёт выдачи",
  needs_changes: "Нужны уточнения",
  rejected: "Отказано",
  cancelled: "Отменена",
  issued: "Выдана",
};
const statusClass: Record<RewardClaim["status"], string> = {
  pending: "pending",
  approved: "approved",
  needs_changes: "pending",
  rejected: "rejected",
  cancelled: "rejected",
  issued: "completed",
};

function History({ claim }: { claim: RewardClaim }) {
  return (
    <details className="assessment-details">
      <summary>Журнал заявки</summary>
      {claim.history.map((h, i) => (
        <p key={i}>
          {new Date(h.at).toLocaleString("ru-RU")} · {h.actor} ·{" "}
          {claimStatus[h.status]}
          {h.note ? ` — ${h.note}` : ""}
        </p>
      ))}
    </details>
  );
}

export function RewardsPage({ eid }: { eid: string }) {
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["rewards", eid],
    queryFn: () =>
      api<{ rewards: RewardItem[]; claims: RewardClaim[] }>(`/rewards/${eid}`),
  });
  const [notes, setNotes] = useState<Record<string, string>>({}),
    [message, setMessage] = useState("");
  async function act(url: string, note = "") {
    setMessage("");
    try {
      await post(url, { note });
      void cache.invalidateQueries({ queryKey: ["rewards", eid] });
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  if (q.isPending) return <div className="loading">Загружаем награды…</div>;
  if (q.isError) return <p className="error">{errorText(q.error)}</p>;
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">ПРИЗНАНИЕ РАЗВИТИЯ</span>
          <h1>Награды</h1>
          <p>
            Только за добровольное развитие. Условия проверяет сервер, решение
            принимает HR. Каждую награду можно получить один раз.
          </p>
        </div>
      </div>
      {message && <p className="error">{message}</p>}
      <div className="reward-grid">
        {q.data.rewards.map((r) => {
          const c = r.claim;
          const open =
            c && ["pending", "approved", "needs_changes"].includes(c.status);
          return (
            <article className="panel reward-card" key={r.reward_id}>
              <div className="panel-title">
                <span className="icon-tile">
                  <Gift />
                </span>
                <span className={`status ${r.eligible ? "approved" : ""}`}>
                  {r.eligible ? "Условие выполнено" : r.progress}
                </span>
              </div>
              <h2>{r.title}</h2>
              <p>{r.description}</p>
              <p className="muted">Условие: {r.rule}</p>
              {!!r.facts.length && (
                <ul className="facts">
                  {r.facts.slice(0, 5).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {c && (
                <p>
                  Заявка:{" "}
                  <span className={`status ${statusClass[c.status]}`}>
                    {claimStatus[c.status]}
                  </span>
                </p>
              )}
              {c?.status === "needs_changes" && (
                <p className="callout">HR: {c.history.at(-1)?.note}</p>
              )}
              {(!c || !open) && c?.status !== "issued" && (
                <>
                  <input
                    aria-label="Комментарий к заявке"
                    placeholder="Комментарий для HR (необязательно)"
                    value={notes[r.reward_id] ?? ""}
                    onChange={(e) =>
                      setNotes({ ...notes, [r.reward_id]: e.target.value })
                    }
                  />
                  <button
                    className="primary"
                    disabled={!r.eligible}
                    onClick={() =>
                      act(
                        `/employees/${eid}/rewards/${r.reward_id}/claim`,
                        notes[r.reward_id],
                      )
                    }
                  >
                    Подать заявку
                  </button>
                </>
              )}
              {c?.status === "needs_changes" && (
                <>
                  <input
                    aria-label="Ответ HR"
                    placeholder="Что уточнили"
                    value={notes[c.claim_id] ?? ""}
                    onChange={(e) =>
                      setNotes({ ...notes, [c.claim_id]: e.target.value })
                    }
                  />
                  <button
                    className="primary"
                    onClick={() =>
                      act(
                        `/employees/${eid}/reward-claims/${c.claim_id}/resubmit`,
                        notes[c.claim_id],
                      )
                    }
                  >
                    Отправить повторно
                  </button>
                </>
              )}
              {c && ["pending", "needs_changes"].includes(c.status) && (
                <button
                  className="text-button"
                  onClick={() =>
                    act(`/employees/${eid}/reward-claims/${c.claim_id}/cancel`)
                  }
                >
                  Отменить заявку
                </button>
              )}
              {c && <History claim={c} />}
            </article>
          );
        })}
      </div>
      {!q.data.rewards.length && (
        <div className="empty">HR ещё не опубликовал каталог наград.</div>
      )}
    </>
  );
}

const kinds: Record<string, string> = {
  book: "Книга",
  learning: "Обучение",
  conference: "Конференция",
  other: "Другое",
};

export function HRRewardsPage({ catalog }: { catalog: Catalog }) {
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["hr-rewards"],
    queryFn: () =>
      api<{ rewards: RewardItem[]; claims: RewardClaim[] }>("/hr/rewards"),
  });
  const [notes, setNotes] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
    [creating, setCreating] = useState(false);
  const refresh = () =>
    void cache.invalidateQueries({ queryKey: ["hr-rewards"] });
  async function act(url: string, body: unknown) {
    setMessage("");
    try {
      await post(url, body);
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function toggle(r: RewardItem) {
    try {
      await api(`/hr/rewards/${r.reward_id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: r.title,
          description: r.description,
          kind: r.kind,
          criterion: r.criterion,
          active: !r.active,
        }),
      });
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  if (q.isPending) return <div className="loading">Загружаем награды…</div>;
  if (q.isError) return <p className="error">{errorText(q.error)}</p>;
  const order = [
    "pending",
    "approved",
    "needs_changes",
    "issued",
    "rejected",
    "cancelled",
  ];
  const claims = [...q.data.claims].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
  );
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">ПРИЗНАНИЕ РАЗВИТИЯ</span>
          <h1>Награды</h1>
          <p>
            Факты по заявке проверены сервером на момент подачи. Решение и
            выдача — отдельные шаги с комментарием и журналом.
          </p>
        </div>
        <button className="primary" onClick={() => setCreating(!creating)}>
          {creating ? "Скрыть форму" : "Новая награда"}
        </button>
      </div>
      {message && <p className="error">{message}</p>}
      {creating && (
        <RewardForm
          catalog={catalog}
          saved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
      <section className="panel">
        <h2>Заявки</h2>
        {!claims.length && <p className="muted">Заявок пока нет.</p>}
        {claims.map((c) => (
          <div className="reassessment" key={c.claim_id}>
            <div className="panel-title">
              <strong>
                {c.full_name} · {c.reward_title}
              </strong>
              <span className={`status ${statusClass[c.status]}`}>
                {claimStatus[c.status]}
              </span>
            </div>
            <small className="muted">
              Критерий версии {c.criterion_version} · подана{" "}
              {new Date(c.created_at).toLocaleDateString("ru-RU")}
              {c.comment ? ` · «${c.comment}»` : ""}
            </small>
            <ul className="facts">
              {c.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {["pending", "approved"].includes(c.status) && (
              <div className="button-group">
                <input
                  aria-label="Комментарий HR"
                  placeholder="Комментарий к решению"
                  value={notes[c.claim_id] ?? ""}
                  onChange={(e) =>
                    setNotes({ ...notes, [c.claim_id]: e.target.value })
                  }
                />
                {c.status === "pending" ? (
                  (
                    [
                      ["approved", "Одобрить", "primary"],
                      ["needs_changes", "На уточнение", "secondary"],
                      ["rejected", "Отказать", "secondary"],
                    ] as const
                  ).map(([decision, label, cls]) => (
                    <button
                      key={decision}
                      className={cls}
                      disabled={(notes[c.claim_id] ?? "").length < 3}
                      onClick={() =>
                        act(`/hr/reward-claims/${c.claim_id}/decision`, {
                          decision,
                          note: notes[c.claim_id],
                        })
                      }
                    >
                      {label}
                    </button>
                  ))
                ) : (
                  <button
                    className="primary"
                    onClick={() =>
                      act(`/hr/reward-claims/${c.claim_id}/issue`, {
                        note: notes[c.claim_id] ?? "",
                      })
                    }
                  >
                    Отметить выдачу
                  </button>
                )}
              </div>
            )}
            <History claim={c} />
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Каталог наград</h2>
        {q.data.rewards.map((r) => (
          <div className="history-row" key={r.reward_id}>
            <div>
              <strong>
                {r.title} · {kinds[r.kind]}
              </strong>
              <small>
                {r.rule} · версия критерия {r.version}
              </small>
            </div>
            <button className="secondary" onClick={() => toggle(r)}>
              {r.active ? "Скрыть" : "Показать"}
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

function RewardForm({
  catalog,
  saved,
}: {
  catalog: Catalog;
  saved: () => void;
}) {
  const voluntary = catalog.events.filter((e) => !e.mandatory);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [kind, setKind] = useState("book"),
    [type, setType] = useState("voluntary_completions"),
    [count, setCount] = useState(3),
    [days, setDays] = useState(365),
    [percent, setPercent] = useState(80),
    [eventId, setEventId] = useState(voluntary[0]?.event_id ?? ""),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const criterion =
      type === "voluntary_completions"
        ? { type, count, period_days: days }
        : type === "course_completed"
          ? { type, event_id: eventId }
          : type === "goal_readiness"
            ? { type, percent }
            : { type };
    try {
      await post("/hr/rewards", { title, description, kind, criterion });
      saved();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section className="panel">
      <h2>Новая награда</h2>
      <form className="course-form" onSubmit={submit}>
        <div className="form-row">
          <label>
            Название
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              minLength={3}
              required
            />
          </label>
          <label>
            Тип
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Описание
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            minLength={10}
            required
          />
        </label>
        <div className="form-row">
          <label>
            Условие
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="voluntary_completions">
                N добровольных мероприятий за период
              </option>
              <option value="course_completed">
                Завершить конкретное мероприятие
              </option>
              <option value="goal_readiness">Готовность к цели от X%</option>
              <option value="goal_critical_closed">
                Все критичные навыки цели закрыты
              </option>
            </select>
          </label>
          {type === "voluntary_completions" && (
            <>
              <label>
                Сколько
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <label>
                За дней
                <input
                  type="number"
                  min={30}
                  max={730}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </label>
            </>
          )}
          {type === "course_completed" && (
            <label>
              Мероприятие
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                {voluntary.map((ev) => (
                  <option key={ev.event_id} value={ev.event_id}>
                    {ev.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type === "goal_readiness" && (
            <label>
              Процент
              <input
                type="number"
                min={50}
                max={100}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
              />
            </label>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary">Опубликовать награду</button>
      </form>
    </section>
  );
}
