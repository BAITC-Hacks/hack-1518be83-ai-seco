import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { api, post } from "./api";
import type { Catalog, History, Profile, Quest } from "./types";
import {
  Bar,
  Empty,
  Metric,
  Modal,
  dateText,
  errorText,
  formats,
  initials,
  plural,
  statuses,
  useToast,
} from "./ui";

export function useProfile(eid: string) {
  return useQuery({
    queryKey: ["profile", eid],
    queryFn: () => api<Profile>(`/employees/${eid}`),
  });
}

export function ProfileView({
  eid,
  catalog,
  viewer,
  onBack,
  openLearning,
}: {
  eid: string;
  catalog: Catalog;
  viewer: "self" | "hr" | "manager";
  onBack?: () => void;
  openLearning?: () => void;
}) {
  const cache = useQueryClient();
  const query = useProfile(eid);
  const [goalOpen, setGoalOpen] = useState(false),
    [completion, setCompletion] = useState<{
      event_id: string;
      title: string;
    } | null>(null),
    [explanations, setExplanations] = useState<Record<string, string>>({}),
    [aiMessage, setAIMessage] = useState(""),
    [aiBusy, setAIBusy] = useState(false);
  if (query.isPending) return <div className="loading">Собираем маршрут…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const p = query.data,
    e = p.employee,
    goal = e.career_goal;
  const canEdit = viewer !== "manager";
  const open = p.gaps.filter((g) => g.gap > 0),
    critical = open.filter((g) => g.critical);
  const completed = p.history.filter((r) => r.status === "completed").length;
  const total = p.gaps.reduce((n, g) => n + g.required, 0),
    attained = p.gaps.reduce((n, g) => n + Math.min(g.current, g.required), 0);
  const uncovered = critical.filter(
    (g) =>
      !p.recommendations.some((q) => q.benefits.some((b) => b.name === g.name)),
  );
  async function askAI() {
    setAIBusy(true);
    setAIMessage("");
    try {
      const r = await post<{
        mode: string;
        explanations: Record<string, string>;
        message?: string;
      }>(`/employees/${eid}/ai-explanation`);
      setExplanations(r.explanations);
      setAIMessage(
        r.mode === "ai"
          ? "AI-объяснение · проверьте факты перед выбором"
          : (r.message ?? ""),
      );
    } catch (err) {
      setAIMessage(errorText(err));
    } finally {
      setAIBusy(false);
    }
  }
  function refresh() {
    setExplanations({});
    void cache.invalidateQueries({ queryKey: ["profile", eid] });
    void cache.invalidateQueries({ queryKey: ["team"] });
    void cache.invalidateQueries({ queryKey: ["card", eid] });
  }
  return (
    <>
      {onBack && (
        <button className="text-button back" onClick={onBack}>
          <ArrowLeft size={16} /> К списку сотрудников
        </button>
      )}
      <div className="section-head">
        <div>
          <p className="section-kicker">
            {viewer === "self" ? "МОЙ КАБИНЕТ" : "ПРОФИЛЬ СОТРУДНИКА"}
          </p>
          <h2>
            {viewer === "self"
              ? "Мой путь к следующему грейду"
              : `Путь развития · ${e.full_name}`}
          </h2>
        </div>
      </div>
      <div className="personal-rating">
        <div>
          <p className="section-kicker">
            {viewer === "self" ? "МОЙ РЕЙТИНГ РАЗВИТИЯ" : "ГОТОВНОСТЬ К ЦЕЛИ"}
          </p>
          <strong>
            {p.readiness ?? "—"}
            <small> / 100</small>
          </strong>
          <p>
            {goal
              ? "Готовность по навыкам к выбранной цели. Без сравнения с коллегами."
              : "Цель не выбрана — рейтинг появится после выбора цели."}
          </p>
        </div>
        <div className="personal-stat">
          <b>{completed}</b>
          <span>завершённых занятий</span>
        </div>
        <div className="personal-stat">
          <b>{p.learning.open.length}</b>
          <span>занятий к завершению</span>
        </div>
        {openLearning && (
          <button className="secondary-button" onClick={openLearning}>
            Моё обучение <ArrowRight size={16} />
          </button>
        )}
      </div>
      <div className="overview-grid">
        <article className="panel profile-card">
          <div className="person-top">
            <div className="person-initials">{initials(e.full_name)}</div>
            <div>
              <h3>{e.full_name}</h3>
              <p>
                {e.role} · {e.grade}
              </p>
            </div>
          </div>
          <div className="profile-meta">
            <div>
              <span>Отдел</span>
              <b>{e.department}</b>
            </div>
            <div>
              <span>Формат работы</span>
              <b>{formats[e.work_format] ?? e.work_format}</b>
            </div>
            <div>
              <span>Оценка навыков</span>
              <b>{dateText(e.last_review_date)}</b>
            </div>
          </div>
          <div className="goal-row">
            <span>
              Текущий грейд <b>{e.grade}</b>
            </span>
            <span className="goal-arrow">→</span>
            <span>
              Цель{" "}
              <b>
                {goal
                  ? `${goal.target_role} · ${goal.target_grade}`
                  : "не выбрана"}
              </b>
            </span>
            {canEdit && (
              <button
                className="text-button goal-edit"
                onClick={() => setGoalOpen(true)}
              >
                {goal ? "Изменить" : "Выбрать цель"}
              </button>
            )}
          </div>
        </article>
        <article className="panel progress-card">
          <div className="panel-head">
            <div>
              <p className="section-kicker">ГОТОВНОСТЬ К ЦЕЛИ</p>
              <h3>Требования целевого грейда</h3>
            </div>
            <span className="readiness-value">
              {p.readiness === null ? "—" : `${p.readiness}%`}
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${p.readiness ?? 0}%` }}
            />
          </div>
          <p className="muted">
            {goal
              ? `${attained} из ${total} требуемых уровней набрано. Это ориентир, не решение о повышении.`
              : p.orientation
                ? `Ориентир: ${p.orientation.role} · ${p.orientation.grade} — ${p.orientation.readiness}% требований. Это подсказка системы, не ваш выбор.`
                : "Выберите цель, чтобы увидеть требования."}
          </p>
          <div className="metrics">
            <div>
              <strong>{p.gaps.length}</strong>
              <span>навыков в профиле цели</span>
            </div>
            <div>
              <strong>{open.length}</strong>
              <span>разрывов до цели</span>
            </div>
            <div>
              <strong>{critical.length}</strong>
              <span>ключевых разрывов</span>
            </div>
          </div>
        </article>
      </div>
      <div className="content-grid">
        <div className="primary-stack">
          <section className="panel block">
            <div className="panel-head">
              <div>
                <p className="section-kicker">СЛЕДУЮЩИЙ ШАГ</p>
                <h3>Рекомендации для развития</h3>
              </div>
              <button
                className="secondary-button"
                onClick={askAI}
                disabled={aiBusy || !p.recommendations.length}
              >
                <Sparkles size={16} />
                {aiBusy
                  ? "AI объясняет…"
                  : catalog.ai_available
                    ? "Объяснить с AI"
                    : "Проверить AI"}
              </button>
            </div>
            <p className="section-caption">
              {aiMessage ||
                "Роль + ключевые навыки + история + доступность. Подбор по правилам, AI только объясняет."}
            </p>
            {uncovered.length > 0 && (
              <div className="critical-notice">
                <b>Нужен отдельный маршрут:</b> для{" "}
                {uncovered.map((g) => g.name).join(", ")} нет подходящего
                доступного занятия с приростом. HR может предложить наставника
                или практику.
              </div>
            )}
            <div className="recommendation-list">
              {p.recommendations.map((q, i) => (
                <Recommendation
                  key={q.event_id}
                  quest={q}
                  index={i}
                  explanation={explanations[q.event_id]}
                  canComplete={canEdit && q.format === "self_paced"}
                  onComplete={() => setCompletion(q)}
                />
              ))}
              {!p.recommendations.length && (
                <Empty>
                  {goal
                    ? "Сейчас нет подходящих шагов в каталоге. Обсудите с HR обучение или наставничество."
                    : "Выберите карьерную цель — и здесь появятся подходящие шаги."}
                </Empty>
              )}
            </div>
          </section>
          <section className="panel block">
            <div className="panel-head">
              <div>
                <p className="section-kicker">ФАКТИЧЕСКАЯ АКТИВНОСТЬ</p>
                <h3>История участия</h3>
              </div>
              <span className="muted">
                {p.history.length}{" "}
                {plural(p.history.length, "запись", "записи", "записей")}
              </span>
            </div>
            <div className="history-stats">
              {Object.entries(statuses)
                .map(([key, label]) => [
                  label,
                  p.history.filter((r) => r.status === key).length,
                ])
                .filter(([, n]) => n)
                .map(([label, n]) => (
                  <span className="history-stat" key={label}>
                    <b>{n}</b>
                    {label}
                  </span>
                ))}
            </div>
            <div className="history-list">
              {p.completions.map((c) => (
                <div className="history-entry" key={c.id}>
                  <b>{c.title}</b>
                  <span className={`status ${c.status}`}>
                    {statuses[c.status]}
                  </span>
                </div>
              ))}
              {p.history.slice(0, 6).map((h) => (
                <div className="history-entry" key={h.record_id}>
                  <b>{h.title}</b>
                  <span>
                    {statuses[h.status]} · {dateText(h.completed_at ?? h.date)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="secondary-stack">
          <section className="panel block">
            <p className="section-kicker">НАВЫКИ</p>
            <h3>Разрывы до цели</h3>
            <p className="section-caption">
              Уровни учитывают завершённые после последней оценки мероприятия.
            </p>
            <div className="skill-list">
              {[...open]
                .sort(
                  (a, b) =>
                    Number(b.critical) - Number(a.critical) || b.gap - a.gap,
                )
                .slice(0, 8)
                .map((g) => (
                  <div
                    className={`skill-row ${g.critical ? "critical" : ""}`}
                    key={g.skill_id}
                  >
                    <div className="skill-line">
                      <b>{g.name}</b>
                      <span>
                        {g.assessed ? g.current : "не оценён"} / {g.required}
                      </span>
                    </div>
                    <Bar
                      value={(g.current / g.required) * 100}
                      tone={g.critical ? "warm" : ""}
                    />
                  </div>
                ))}
              {goal && !open.length && (
                <Empty>Все требования цели выполнены.</Empty>
              )}
              {!goal && <Empty>Разрывы появятся после выбора цели.</Empty>}
            </div>
          </section>
          <section className="panel explain-panel">
            <p className="section-kicker">КАК ЭТО РАБОТАЕТ</p>
            <h3>Решение можно проверить</h3>
            <p>
              Для каждого занятия сервер проверяет роль, грейд, предпосылки,
              расписание и историю. Прирост считается по правилам <b>gain</b> и{" "}
              <b>max_level</b>.
            </p>
            <p>
              Обязательные задания видны в «Моём обучении», но не выдаются за
              рекомендации. Завершение подтверждает HR — только после этого
              меняются уровни.
            </p>
          </section>
        </div>
      </div>
      {goal && (
        <section className="panel block grade-panel">
          <p className="section-kicker">ПОНЯТНЫЕ УСЛОВИЯ РОСТА</p>
          <h3>
            Что нужно для {goal.target_role} · {goal.target_grade}
          </h3>
          <p className="section-caption">
            Рейтинг = {attained} освоенных уровней из {total} требуемых × 100.
            Уровень выше требования не даёт лишних баллов. Выполнение матрицы —
            повод обсудить повышение, а не автоматическое решение.
          </p>
          <div className="grade-steps">
            <div>
              <span>01</span>
              <b>Закрыть ключевые разрывы</b>
              <p>Осталось: {critical.length}</p>
            </div>
            <div>
              <span>02</span>
              <b>Пройти маршрут обучения</b>
              <p>Завершить назначения и выбрать подходящие рекомендации.</p>
            </div>
            <div>
              <span>03</span>
              <b>Подтвердить навыки</b>
              <p>Обсудить практические результаты и оценку с руководителем.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="grade-table">
              <thead>
                <tr>
                  <th>Навык</th>
                  <th>Сейчас</th>
                  <th>Нужно</th>
                  <th>Прогресс</th>
                </tr>
              </thead>
              <tbody>
                {[...p.gaps]
                  .sort(
                    (a, b) =>
                      Number(b.critical) - Number(a.critical) || b.gap - a.gap,
                  )
                  .map((g) => (
                    <tr key={g.skill_id}>
                      <td>
                        {g.name}{" "}
                        {g.critical && (
                          <span className="key-label">ключевой</span>
                        )}
                      </td>
                      <td>{g.assessed ? g.current : "—"}</td>
                      <td>{g.required}</td>
                      <td>
                        {g.gap ? `Осталось уровней: ${g.gap}` : "✓ Выполнено"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="footnote">
        {p.notice} Длительность на текущем грейде: нет данных.
      </p>
      {goalOpen && (
        <GoalModal
          profile={p}
          catalog={catalog}
          close={() => setGoalOpen(false)}
          saved={refresh}
        />
      )}
      {completion && (
        <CompletionModal
          eid={eid}
          event={completion}
          profile={p}
          close={() => setCompletion(null)}
          saved={refresh}
        />
      )}
    </>
  );
}

function Recommendation({
  quest: q,
  index,
  explanation,
  canComplete,
  onComplete,
}: {
  quest: Quest;
  index: number;
  explanation?: string;
  canComplete: boolean;
  onComplete: () => void;
}) {
  return (
    <article className={`recommendation ${index === 0 ? "featured" : ""}`}>
      <div className="recommendation-head">
        <span className="rank">0{index + 1}</span>
        <div>
          <h4>{q.title}</h4>
          <p className="rec-sub">
            {formats[q.format]} · {q.duration_hours} ч ·{" "}
            {q.next_session
              ? `сессия ${dateText(q.next_session)}`
              : "доступно сейчас"}
          </p>
        </div>
        {q.benefits.some((b) => b.critical) && (
          <span className="key-label">ключевой навык</span>
        )}
      </div>
      <p>{explanation || q.reason}</p>
      {q.past_misses > 0 && (
        <p className="warn-text">
          В истории {q.past_misses}{" "}
          {plural(q.past_misses, "пропуск", "пропуска", "пропусков")} или отказ
          этого мероприятия за 180 дней — стоит обсудить формат.
        </p>
      )}
      <div className="rec-impact">
        {q.benefits.map((b) => (
          <span className="impact-pill" key={b.name}>
            {b.name} {b.from} → {b.to}
          </span>
        ))}
      </div>
      {canComplete && (
        <button className="text-button" onClick={onComplete}>
          Сообщить о завершении →
        </button>
      )}
    </article>
  );
}

export function Learning({ eid }: { eid: string }) {
  const cache = useQueryClient();
  const query = useProfile(eid);
  const [completion, setCompletion] = useState<History | null>(null);
  if (query.isPending)
    return <div className="loading">Загружаем обучение…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const p = query.data;
  const completed = p.history.filter((r) => r.status === "completed");
  const mandatory = p.learning.open.filter((r) => r.mandatory);
  return (
    <>
      <div className="section-head">
        <div>
          <p className="section-kicker">МОЁ ОБУЧЕНИЕ</p>
          <h2>Пройдено, в работе и впереди</h2>
          <p className="section-caption no-margin">
            История и назначения из датасета, без вымышленных результатов
            обучения.
          </p>
        </div>
      </div>
      <div className="metrics-grid">
        <Metric label="Завершено" value={completed.length} />
        <Metric
          label="Обязательных к завершению"
          value={mandatory.length}
          tone="warm"
        />
        <Metric
          label="В процессе"
          value={
            p.learning.open.filter((r) => r.status === "in_progress").length
          }
        />
        <Metric
          label="Рекомендаций"
          value={p.recommendations.length}
          tone="teal"
        />
      </div>
      <section className="panel block">
        <h3>Нужно завершить</h3>
        <p className="section-caption">
          Обязательные занятия с незавершённой последней записью и обучение в
          процессе. Рекомендации по развитию обязательными не считаются.
        </p>
        <LearningRows rows={p.learning.open} onComplete={setCompletion} />
      </section>
      <section className="panel block">
        <h3>Рекомендовано для моей цели</h3>
        {p.recommendations.map((r) => (
          <article className="learning-row" key={r.event_id}>
            <div>
              <b>{r.title}</b>
              <p>
                {r.duration_hours} ч · {formats[r.format]} ·{" "}
                {r.next_session ? dateText(r.next_session) : "доступно сейчас"}
              </p>
              <p>
                {r.benefits
                  .map((b) => `${b.name}: ${b.from} → ${b.to}`)
                  .join(" · ")}
              </p>
            </div>
            <span className="source-badge">Рекомендация</span>
          </article>
        ))}
        {!p.recommendations.length && (
          <Empty>
            Нет доступных занятий с приростом к цели. Обсудите практику или
            наставничество с руководителем.
          </Empty>
        )}
      </section>
      <section className="panel block">
        <h3>Уже пройдено</h3>
        <LearningRows rows={completed} />
      </section>
      {completion && (
        <CompletionModal
          eid={eid}
          event={completion}
          profile={p}
          close={() => setCompletion(null)}
          saved={() =>
            void cache.invalidateQueries({ queryKey: ["profile", eid] })
          }
        />
      )}
    </>
  );
}

function LearningRows({
  rows,
  onComplete,
}: {
  rows: History[];
  onComplete?: (row: History) => void;
}) {
  if (!rows.length) return <Empty>Таких записей нет.</Empty>;
  return (
    <>
      {rows.map((r) => (
        <article className="learning-row" key={r.record_id}>
          <div>
            <b>{r.title}</b>
            <p>
              {r.mandatory ? "Обязательное" : "Добровольное"} ·{" "}
              {dateText(r.completed_at ?? r.date)}
              {r.due_date ? ` · срок ${dateText(r.due_date)}` : ""}
              {r.score != null ? ` · результат ${r.score}/100` : ""}
            </p>
          </div>
          <div className="row-actions">
            <span className={`status ${r.status}`}>
              {statuses[r.status]}
              {r.status === "in_progress" && r.completion_pct != null
                ? ` · ${r.completion_pct}%`
                : ""}
            </span>
            {onComplete && r.status === "in_progress" && !r.mandatory && (
              <button className="text-button" onClick={() => onComplete(r)}>
                Сообщить о завершении
              </button>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

function GoalModal({
  profile: p,
  catalog,
  close,
  saved,
}: {
  profile: Profile;
  catalog: Catalog;
  close: () => void;
  saved: () => void;
}) {
  const toast = useToast();
  const [role, setRole] = useState(
      p.employee.career_goal?.target_role ?? p.employee.role,
    ),
    [grade, setGrade] = useState(
      p.employee.career_goal?.target_grade ?? p.employee.grade,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/employees/${p.employee.employee_id}/goal`, {
        method: "PUT",
        body: JSON.stringify({ target_role: role, target_grade: grade }),
      });
      saved();
      close();
      toast("Цель сохранена. Требования и рекомендации пересчитаны.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Карьерная цель" close={close}>
      <p>
        Можно развиваться в текущей роли или выбрать новое направление. Цель —
        ваш выбор.
      </p>
      <form onSubmit={save}>
        <label>
          Направление
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {[...new Set(catalog.profiles.map((x) => x.role))].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Целевой грейд
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            {["Junior", "Middle", "Senior", "Lead"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary-button full" disabled={busy}>
          Сохранить цель
        </button>
      </form>
    </Modal>
  );
}

function CompletionModal({
  eid,
  event,
  profile,
  close,
  saved,
}: {
  eid: string;
  event: { event_id: string; title: string };
  profile: Profile;
  close: () => void;
  saved: () => void;
}) {
  const toast = useToast();
  const [when, setWhen] = useState(profile.as_of),
    [evidence, setEvidence] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/employees/${eid}/completions`, {
        event_id: event.event_id,
        completed_at: when,
        evidence,
      });
      saved();
      close();
      toast("Заявка отправлена HR. Навыки изменятся после подтверждения.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Подтверждение завершения" close={close}>
      <p>{event.title}</p>
      <div className="callout">
        Это заявка на проверку HR. До подтверждения навыки не изменятся.
      </div>
      <form onSubmit={save}>
        <label>
          Фактическая дата завершения
          <input
            type="date"
            value={when}
            max={profile.as_of}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </label>
        <label>
          Что получилось и чем подтвердить
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            minLength={8}
            maxLength={1500}
            placeholder="Результат практики, ссылка на сертификат или выполненное задание…"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary-button full" disabled={busy}>
          Отправить HR
        </button>
      </form>
    </Modal>
  );
}
