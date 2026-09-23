import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api, post } from "./api";
import type {
  Card,
  Catalog,
  Completion,
  Level,
  Source,
  TeamOverview,
  TeamRow,
  User,
} from "./types";
import {
  Bar,
  Empty,
  Metric,
  Modal,
  PriorityBadge,
  SourceBadge,
  dateText,
  errorText,
  formats,
  levels,
  plural,
  sourceNames,
  statuses,
  targetText,
  useToast,
} from "./ui";

export type TeamFilter = { department: string; role: string };
export type Queue = "all" | Level | "growth";
const PAGE = 10;

export function useTeam(filter: TeamFilter) {
  const params = new URLSearchParams();
  if (filter.department) params.set("department", filter.department);
  if (filter.role) params.set("role", filter.role);
  return useQuery({
    queryKey: ["team", filter.department, filter.role],
    queryFn: () => api<TeamOverview>(`/team/overview?${params}`),
  });
}

export function TeamFilters({
  data,
  filter,
  setFilter,
  isHR,
}: {
  data: TeamOverview;
  filter: TeamFilter;
  setFilter: (f: TeamFilter) => void;
  isHR: boolean;
}) {
  return (
    <div className="filter-group">
      {isHR ? (
        <label className="field">
          <span>Отдел</span>
          <select
            value={filter.department}
            onChange={(e) =>
              setFilter({ ...filter, department: e.target.value })
            }
          >
            <option value="">Все отделы</option>
            {data.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="field">
          <span>Отдел</span>
          <b className="fixed-field">{data.scope.department}</b>
        </div>
      )}
      <label className="field">
        <span>Специализация</span>
        <select
          value={filter.role}
          onChange={(e) => setFilter({ ...filter, role: e.target.value })}
        >
          <option value="">Все специализации</option>
          {data.roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <p className="muted">
        {isHR
          ? "Фильтры применяются к аналитике и списку сотрудников."
          : "Только ваш отдел. Другие отделы в этом кабинете не видны."}
      </p>
    </div>
  );
}

export function TeamDashboard({
  user,
  catalog,
  filter,
  setFilter,
  openPeople,
  openCard,
}: {
  user: User;
  catalog: Catalog;
  filter: TeamFilter;
  setFilter: (f: TeamFilter) => void;
  openPeople: (queue: Queue) => void;
  openCard: (eid: string) => void;
}) {
  const query = useTeam(filter);
  const cache = useQueryClient();
  const isHR = user.role === "hr";
  const [importOpen, setImportOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false),
    [review, setReview] = useState<Completion | null>(null),
    [allInsights, setAllInsights] = useState(false);
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["team"] });
    void cache.invalidateQueries({ queryKey: ["profile"] });
  };
  if (query.isPending)
    return <div className="loading">Собираем аналитику…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const d = query.data,
    m = d.metrics,
    a = d.activity;
  const insights = allInsights ? d.insights : d.insights.slice(0, 6);
  return (
    <>
      <div className="section-head">
        <div>
          <p className="section-kicker">АНАЛИТИКА РАЗВИТИЯ</p>
          <h2>
            {isHR
              ? "Где сотрудникам нужна поддержка"
              : "Где моему отделу нужна поддержка"}
          </h2>
          <p className="section-caption no-margin">
            Профили и обучение — из датасета. GitHub и Jira — синтетические
            демо-данные.
          </p>
        </div>
        <div className="button-row">
          {isHR && (
            <>
              <button
                className="secondary-button"
                onClick={() => setImportOpen(true)}
              >
                <ArrowDownToLine size={16} /> Импорт
              </button>
              <button
                className="secondary-button"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={16} /> Сотрудник
              </button>
            </>
          )}
          <button className="primary-button" onClick={() => openPeople("all")}>
            Открыть список сотрудников <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <TeamFilters data={d} filter={filter} setFilter={setFilter} isHR={isHR} />
      <div className="metrics-grid">
        <Metric
          label="Сотрудников"
          value={m.employees}
          note="В выбранных отделах и ролях"
        />
        <Metric
          label="С ключевым разрывом"
          value={m.with_critical_gap}
          note="До цели или ориентира"
          tone="warm"
        />
        <Metric
          label="Средняя готовность"
          value={m.avg_readiness === null ? "—" : `${m.avg_readiness}%`}
          note="К цели · не оценка эффективности"
          tone="teal"
        />
        <Metric
          label="Без карьерной цели"
          value={m.without_goal}
          note="Повод для карьерного разговора"
        />
      </div>
      <div className="support-overview">
        {(["high", "medium", "planned"] as Level[]).map((level) => (
          <button
            key={level}
            className={`support-summary ${level}`}
            onClick={() => openPeople(level)}
          >
            <span>{levels[level]} приоритет помощи</span>
            <strong>{d.priority_counts[level]}</strong>
            <small>Открыть сотрудников →</small>
          </button>
        ))}
        <button
          className="support-summary growth"
          onClick={() => openPeople("growth")}
        >
          <span>Готовы к росту</span>
          <strong>{d.growth_count}</strong>
          <small>Обсудить переход →</small>
        </button>
      </div>
      {isHR && d.pending.length > 0 && (
        <section className="panel block">
          <div className="panel-head">
            <div>
              <p className="section-kicker">ПОДТВЕРЖДЕНИЕ ОБУЧЕНИЯ</p>
              <h3>Ожидают вашего решения · {d.pending.length}</h3>
            </div>
          </div>
          {d.pending.map((c) => (
            <div className="learning-row" key={c.id}>
              <div>
                <b>
                  {c.full_name} · {c.title}
                </b>
                <p>{c.evidence}</p>
              </div>
              <button className="secondary-button" onClick={() => setReview(c)}>
                Рассмотреть
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="source-strip">
        <div>
          <b>Рабочий контекст команды</b>
          <p>
            GitHub: {d.sources.github} подключено из {d.sources.github_accounts}{" "}
            аккаунтов · Jira: {d.sources.jira} из {m.employees} · Без
            подключений: {d.sources.none}. У кого нет GitHub, тому он не
            добавляется.
          </p>
        </div>
        <span className="muted">Подключениями управляют сами сотрудники</span>
      </div>
      <div className="two-grid">
        <section className="panel block">
          <p className="section-kicker">ДАННЫЕ ХАКАТОНА</p>
          <h3>Самые частые разрывы в навыках</h3>
          <p className="section-caption">
            Число сотрудников ниже требований цели. Если цель не выбрана —
            следующий грейд как ориентир.
          </p>
          <div className="gap-bars">
            {d.gaps.map((g) => (
              <div className="gap-row" key={g.name}>
                <b>{g.name}</b>
                <Bar value={(g.count / Math.max(m.employees, 1)) * 100} />
                <span>{g.count}</span>
              </div>
            ))}
            {!d.gaps.length && <Empty>Для этой выборки разрывов нет.</Empty>}
          </div>
        </section>
        <section className="panel block">
          <p className="section-kicker">ОБУЧЕНИЕ</p>
          <h3>Итоги участия</h3>
          <p className="section-caption">
            01.10.2024–30.09.2026 · записи датасета.
          </p>
          {[
            ["Завершено", a.completed],
            ["Добровольных завершено", a.voluntary_completed],
            ["Неявки", a.no_show],
            ["Прервано", a.dropped],
            ["Отказы", a.declined],
            ["В процессе", a.in_progress],
            ["Просрочено обязательных", m.overdue],
          ].map(([label, value]) => (
            <div className="activity-row" key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </section>
      </div>
      <section className="panel block">
        <div className="panel-head">
          <div>
            <p className="section-kicker">GITHUB + JIRA → КОНТЕКСТ ДЛЯ HR</p>
            <h3>
              Что стоит обсудить с сотрудниками{" "}
              <span className="demo-tag">ДЕМО</span>
            </h3>
          </div>
          <span className="muted">
            {d.insights.length}{" "}
            {plural(
              d.insights.length,
              "сотрудник",
              "сотрудника",
              "сотрудников",
            )}{" "}
            с сигналами
          </span>
        </div>
        <p className="section-caption">
          Замечания из рабочих эпизодов сопоставляются с матрицей навыков. Это
          гипотеза для разговора: уровни навыков не меняются.
        </p>
        <div className="insights-grid">
          {insights.map((s) => (
            <article className="insight-card" key={s.employee_id}>
              <div className="insight-meta">
                <span className="source-badge">
                  {s.sources.map((x) => sourceNames[x]).join(" + ")}
                </span>
                <span
                  className={`review-status ${s.discussed ? "reviewed" : ""}`}
                >
                  {s.discussed
                    ? "К обсуждению"
                    : s.sufficient
                      ? "Проверить гипотезу"
                      : "Мало данных"}
                </span>
              </div>
              <h4>{s.title}</h4>
              <p className="insight-person">
                {s.full_name} · {s.role}
              </p>
              <p>{s.text}</p>
              <button
                className="text-button"
                onClick={() => openCard(s.employee_id)}
              >
                Разобрать {s.evidence}{" "}
                {plural(s.evidence, "пример", "примера", "примеров")} →
              </button>
            </article>
          ))}
        </div>
        {!d.insights.length && (
          <Empty>
            В этой выборке нет подключённых источников. Это не значит, что у
            сотрудников нет навыков.
          </Empty>
        )}
        {d.insights.length > 6 && (
          <button
            className="text-button"
            onClick={() => setAllInsights(!allInsights)}
          >
            {allInsights
              ? "Свернуть сигналы"
              : `Показать все сигналы (${d.insights.length})`}
          </button>
        )}
      </section>
      <PriorityMethod />
      {importOpen && (
        <ImportModal close={() => setImportOpen(false)} saved={refresh} />
      )}
      {createOpen && (
        <CreateModal
          catalog={catalog}
          close={() => setCreateOpen(false)}
          saved={refresh}
        />
      )}
      {review && (
        <ReviewModal
          item={review}
          close={() => setReview(null)}
          saved={refresh}
        />
      )}
    </>
  );
}

function PriorityMethod() {
  return (
    <details className="priority-method">
      <summary>Как считается приоритет помощи и готовность к росту</summary>
      <p>
        <b>Приоритет помощи</b> = 100 × (0,30·К + 0,20·Д + 0,20·С + 0,15·В +
        0,15·Ц). К — недостающие уровни ключевых навыков текущего грейда (3 и
        больше = 1). Д — покрытие требований текущего грейда (85% и выше = 0,
        60% и ниже = 1). К и Д умножаются на стаж/12 мес — новичкам поблажка. С
        — нет завершённого добровольного обучения за 6 месяцев. В — пропусков и
        отказов за год больше, чем завершений. Ц — нет карьерной цели при стаже
        от года.
      </p>
      <p>
        Высокий — от 50 баллов, средний — от 40, остальное — плановое развитие.
        Просроченное обязательное обучение показывается отдельно и в балл не
        входит. GitHub и Jira на очередь не влияют: отсутствие подключения не
        снижает оценку.
      </p>
      <p>
        <b>Готовность к росту</b> = 100 × (0,35·готовность к цели +
        0,25·закрытые ключевые навыки + 0,15·прирост уровней за год + 0,15·запас
        по текущему грейду + 0,10·вовлечённость). От 65 баллов — повод обсудить
        повышение. Это очередь поддержки, а не рейтинг эффективности.
      </p>
    </details>
  );
}

function sortRows(rows: TeamRow[], queue: Queue) {
  const rank: Record<Level, number> = { high: 0, medium: 1, planned: 2 };
  return queue === "growth"
    ? [...rows].sort((a, b) => b.growth.score - a.growth.score)
    : [...rows].sort(
        (a, b) =>
          rank[a.priority.level] - rank[b.priority.level] ||
          b.priority.score - a.priority.score ||
          a.full_name.localeCompare(b.full_name, "ru"),
      );
}

export function People({
  user,
  filter,
  setFilter,
  queue,
  setQueue,
  openCard,
}: {
  user: User;
  filter: TeamFilter;
  setFilter: (f: TeamFilter) => void;
  queue: Queue;
  setQueue: (q: Queue) => void;
  openCard: (eid: string) => void;
}) {
  const query = useTeam(filter);
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  if (query.isPending)
    return <div className="loading">Собираем очередь поддержки…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const d = query.data;
  const text = search.trim().toLocaleLowerCase("ru");
  const matching = sortRows(
    d.employees.filter(
      (e) =>
        (queue === "all" ||
          (queue === "growth" ? e.growth.ready : e.priority.level === queue)) &&
        `${e.full_name} ${e.employee_id}`
          .toLocaleLowerCase("ru")
          .includes(text),
    ),
    queue,
  );
  const pages = Math.max(1, Math.ceil(matching.length / PAGE)),
    current = Math.min(page, pages - 1),
    visible = matching.slice(current * PAGE, current * PAGE + PAGE);
  const counts: [Queue, string, number][] = [
    ["all", "Все", d.employees.length],
    ["high", "Высокий", d.priority_counts.high],
    ["medium", "Средний", d.priority_counts.medium],
    ["planned", "Плановый", d.priority_counts.planned],
    ["growth", "Готовы к росту", d.growth_count],
  ];
  let group = "";
  return (
    <>
      <div className="section-head">
        <div>
          <p className="section-kicker">ПОДДЕРЖКА СОТРУДНИКОВ</p>
          <h2>
            {user.role === "hr" ? "Все сотрудники" : "Сотрудники моего отдела"}
          </h2>
          <p className="section-caption no-margin">
            Сначала те, кому может понадобиться помощь. Это очередь поддержки,
            не рейтинг эффективности.
          </p>
        </div>
      </div>
      <TeamFilters
        data={d}
        filter={filter}
        setFilter={(f) => {
          setPage(0);
          setFilter(f);
        }}
        isHR={user.role === "hr"}
      />
      <PriorityMethod />
      <div className="priority-filters" role="group" aria-label="Очередь">
        {counts.map(([key, label, count]) => (
          <button
            key={key}
            className={`priority-filter ${key === queue ? "selected" : ""}`}
            aria-pressed={key === queue}
            onClick={() => {
              setQueue(key);
              setPage(0);
            }}
          >
            {label} <b>{count}</b>
          </button>
        ))}
      </div>
      <section className="panel block">
        <div className="panel-head">
          <h3>
            Сотрудники <span className="muted">· {matching.length}</span>
          </h3>
          <label className="search">
            <Search size={16} />
            <input
              type="search"
              aria-label="Поиск по имени или ID"
              placeholder="Имя или E0028"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <div className="table-scroll">
          <table className="employee-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>
                  {queue === "growth"
                    ? "Готовность к росту"
                    : "Приоритет помощи"}
                </th>
                <th>До цели</th>
                <th>Разрывы</th>
                <th>Источники · демо</th>
                <th>Карточка</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const head =
                  queue !== "growth" && group !== e.priority.level ? (
                    <tr className={`priority-group ${e.priority.level}`}>
                      <th colSpan={6}>
                        {levels[e.priority.level]} приоритет помощи ·{" "}
                        {d.priority_counts[e.priority.level]} в выбранной
                        команде
                      </th>
                    </tr>
                  ) : null;
                group = e.priority.level;
                return [
                  head,
                  <tr key={e.employee_id}>
                    <td>
                      <b>{e.full_name}</b>
                      <small>
                        {e.role} · {e.grade}
                      </small>
                      <small>
                        {e.department} · {e.employee_id}
                      </small>
                    </td>
                    <td>
                      {queue === "growth" ? (
                        <>
                          <span className="priority-badge growth">
                            {e.growth.score} / 100
                          </span>
                          <small>
                            {e.growth.ready
                              ? "Обсудить переход"
                              : "Пока рано для перехода"}
                          </small>
                        </>
                      ) : (
                        <>
                          <PriorityBadge level={e.priority.level} />
                          <small>
                            {e.priority.score} / 100 · {e.priority.reasons[0]}
                          </small>
                          {e.priority.overdue_mandatory > 0 && (
                            <small className="warn-text">
                              Просрочено обязательных:{" "}
                              {e.priority.overdue_mandatory}
                            </small>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <b>{e.readiness}%</b>
                      <Bar value={e.readiness} />
                      <small>{targetText(e.target)}</small>
                    </td>
                    <td>
                      {e.gaps}
                      <small>Ключевых: {e.critical_gaps}</small>
                    </td>
                    <td>
                      {(["github", "jira"] as Source[]).map((s) => (
                        <SourceBadge key={s} source={s} status={e.sources[s]} />
                      ))}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        aria-label={`Карточка: ${e.full_name}`}
                        onClick={() => openCard(e.employee_id)}
                      >
                        Открыть →
                      </button>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        {!matching.length && (
          <Empty>Сотрудники не найдены. Измените поиск или фильтры.</Empty>
        )}
        <div className="pagination">
          <span>
            {matching.length
              ? `${current * PAGE + 1}–${Math.min(current * PAGE + PAGE, matching.length)} из ${matching.length}`
              : "Нет сотрудников"}
          </span>
          <div>
            <button
              className="secondary-button"
              aria-label="Предыдущая страница"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              ←
            </button>
            <button
              className="secondary-button"
              aria-label="Следующая страница"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              →
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

export function EmployeeCard({
  eid,
  close,
  openProfile,
}: {
  eid: string;
  close: () => void;
  openProfile: (eid: string) => void;
}) {
  const cache = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["card", eid],
    queryFn: () => api<Card>(`/team/employees/${eid}`),
  });
  const [busy, setBusy] = useState(false);
  const title = query.data
    ? `Карточка · ${query.data.employee.full_name}`
    : "Карточка";
  async function discuss() {
    setBusy(true);
    try {
      await post(`/team/employees/${eid}/discuss`);
      void cache.invalidateQueries({ queryKey: ["card", eid] });
      void cache.invalidateQueries({ queryKey: ["team"] });
      toast("Отмечено к обсуждению. Уведомления не отправлялись.");
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} close={close} wide>
      {query.isPending && <div className="loading">Загружаем карточку…</div>}
      {query.isError && <p className="error">{errorText(query.error)}</p>}
      {query.data &&
        (() => {
          const c = query.data,
            p = c.priority,
            signal = c.integrations.signal;
          const rec = signal
            ? c.recommendations.find((r) =>
                r.benefits.some((b) => b.name === signal.skill),
              )
            : undefined;
          return (
            <div className="card-body">
              <div className="person-detail">
                <div>
                  <b>
                    {c.employee.role} · {c.employee.grade}
                  </b>
                  <p>
                    {c.employee.department} · {c.employee.employee_id}
                  </p>
                  <p>
                    Руководитель: {c.manager ?? "не указан"}
                    <br />
                    Последняя оценка: {dateText(c.employee.last_review_date)}
                  </p>
                </div>
                <div className="detail-readiness">
                  <strong>{c.readiness}%</strong>
                  <span>к {targetText(c.target)}</span>
                </div>
              </div>
              <div className="support-reasons">
                <div className="reason-head">
                  <PriorityBadge level={p.level} />
                  <b>{p.score} / 100</b>
                  {c.growth.ready && (
                    <span className="priority-badge growth">
                      Готов к росту · {c.growth.score}
                    </span>
                  )}
                </div>
                <div className="factor-list">
                  {p.factors.map((f) => (
                    <div key={f.key} className={f.points ? "" : "zero"}>
                      <span>{f.label}</span>
                      <Bar
                        value={(f.points / (f.weight * 100)) * 100}
                        tone="warm"
                      />
                      <b>
                        {f.points} / {f.weight * 100}
                      </b>
                      {f.points > 0 && f.detail && <small>{f.detail}</small>}
                    </div>
                  ))}
                </div>
                {p.overdue_mandatory > 0 && (
                  <p className="warn-text">
                    Просрочено обязательных занятий: {p.overdue_mandatory}. Это
                    комплаенс, в балл развития не входит.
                  </p>
                )}
                <small>
                  Очередь поддержки по прозрачному правилу, не оценка
                  эффективности.
                </small>
              </div>
              <h3>
                Выжимка из GitHub и Jira <span className="demo-tag">ДЕМО</span>
              </h3>
              <div className="source-digests">
                {(["github", "jira"] as Source[]).map((s) => {
                  const src = c.integrations.sources[s];
                  return (
                    <section className="source-digest" key={s}>
                      <SourceBadge source={s} status={src.status} />
                      {src.status === "connected" && src.summary ? (
                        <>
                          <h4>
                            {s === "github"
                              ? `${src.summary.merged} из ${src.summary.items} PR слито · ${src.summary.reviews} ревью`
                              : `${src.summary.done} из ${src.summary.items} задач закрыто · ${src.summary.story_points} SP`}
                          </h4>
                          <p>
                            Чаще всего в работе:{" "}
                            {src.top_skills
                              ?.map((t) => `${t.name} (${t.count})`)
                              .join(", ")}
                          </p>
                          <small>{src.resources?.join(", ")}</small>
                        </>
                      ) : (
                        <p>
                          {src.status === "no_account"
                            ? "У сотрудника нет аккаунта GitHub — источник не используется и не влияет на оценку."
                            : "Сотрудник не подключил источник. По отсутствию данных нельзя судить о навыках."}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
              {signal ? (
                <div className="signal-block">
                  <h3>{signal.title}</h3>
                  <p>{signal.text}</p>
                  <p className="evidence-summary">
                    Период: {signal.period} · {signal.evidence.length}{" "}
                    {plural(
                      signal.evidence.length,
                      "эпизод",
                      "эпизода",
                      "эпизодов",
                    )}
                  </p>
                  <div className="evidence-list">
                    {signal.evidence.map((ev) => (
                      <article className="evidence-card" key={ev.id}>
                        <div>
                          <span className="source-badge">
                            {sourceNames[ev.source]}
                          </span>
                          <span className="muted">{dateText(ev.date)}</span>
                        </div>
                        <h4>
                          {ev.id} · {ev.title}
                        </h4>
                        <p>{ev.note}</p>
                        <small>{ev.resource} · вымышленный пример</small>
                      </article>
                    ))}
                  </div>
                  <div className="suggested-step">
                    <p className="section-kicker">ПРЕДЛОЖЕННЫЙ ШАГ</p>
                    <h3>
                      {!signal.sufficient
                        ? "Собрать больше контекста"
                        : rec
                          ? rec.title
                          : "Практика с наставником"}
                    </h3>
                    <p>
                      {!signal.sufficient
                        ? "Обсудить рабочий эпизод с сотрудником и получить дополнительные примеры."
                        : rec
                          ? `Мероприятие из каталога: ${rec.duration_hours} ч · ${formats[rec.format]}.`
                          : `${signal.practice} Это предложение, не мероприятие из каталога.`}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    disabled={busy || c.discussed}
                    onClick={discuss}
                  >
                    {c.discussed
                      ? "Отмечено к обсуждению"
                      : "Отметить к обсуждению"}
                  </button>
                </div>
              ) : (
                <Empty>
                  Выжимки нет: сотрудник не подключил GitHub или Jira. Ниже —
                  разрывы и рекомендации из профиля и истории обучения.
                </Empty>
              )}
              <h3>Над чем поработать по матрице навыков</h3>
              <div className="detail-gap-list">
                {c.gaps
                  .filter((g) => g.gap > 0)
                  .map((g) => (
                    <div key={g.skill_id}>
                      <span>
                        {g.name}{" "}
                        {g.critical && <b className="key-label">ключевой</b>}
                      </span>
                      <b>
                        {g.current} → {g.required}
                      </b>
                    </div>
                  ))}
                {!c.gaps.some((g) => g.gap > 0) && (
                  <p>Требования цели выполнены.</p>
                )}
              </div>
              <h3>Ближайшее обучение для развития</h3>
              {c.recommendations.map((r) => (
                <div className="learning-row" key={r.event_id}>
                  <div>
                    <b>{r.title}</b>
                    <p>
                      {r.duration_hours} ч ·{" "}
                      {r.next_session
                        ? dateText(r.next_session)
                        : "в своём темпе"}
                    </p>
                  </div>
                  <span className="source-badge">
                    {r.benefits
                      .map((b) => `${b.name} ${b.from} → ${b.to}`)
                      .join(" · ")}
                  </span>
                </div>
              ))}
              {!c.recommendations.length && (
                <Empty>
                  В каталоге нет подходящих доступных занятий с приростом. Нужен
                  отдельный маршрут с наставником.
                </Empty>
              )}
              <h3>Назначения к завершению</h3>
              {c.open_learning.map((r) => (
                <div className="learning-row" key={r.record_id}>
                  <div>
                    <b>{r.title}</b>
                    <p>
                      {r.mandatory ? "Обязательное" : "Добровольное"} ·{" "}
                      {dateText(r.date)}
                      {r.due_date ? ` · срок ${dateText(r.due_date)}` : ""}
                    </p>
                  </div>
                  <span className={`status ${r.status}`}>
                    {statuses[r.status]}
                  </span>
                </div>
              ))}
              {!c.open_learning.length && (
                <Empty>Незавершённых назначений нет.</Empty>
              )}
              <div className="button-row card-actions">
                <button
                  className="secondary-button"
                  onClick={() => openProfile(eid)}
                >
                  Открыть полный профиль <ArrowRight size={16} />
                </button>
              </div>
            </div>
          );
        })()}
    </Modal>
  );
}

function ImportModal({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const [employees, setEmployees] = useState<File>(),
    [history, setHistory] = useState<File>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData();
    if (employees) form.append("employees", employees);
    if (history) form.append("history", history);
    try {
      const r = await api<{ inserted: number }>("/hr/import", {
        method: "POST",
        body: form,
      });
      setMessage(
        `Добавлено записей: ${r.inserted}. Существующие данные не перезаписаны.`,
      );
      saved();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Импорт проверочных данных" close={close}>
      <p>
        Исходная схема датасета. До 5 МБ на файл. Используйте только
        синтетические профили.
      </p>
      <form onSubmit={submit}>
        <label>
          Профили employees.json
          <input
            type="file"
            accept=".json"
            onChange={(e) => setEmployees(e.target.files?.[0])}
          />
        </label>
        <label>
          История activity_history.csv
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setHistory(e.target.files?.[0])}
          />
        </label>
        {message && <p role="status">{message}</p>}
        <button
          className="primary-button full"
          disabled={busy || (!employees && !history)}
        >
          {busy ? "Проверяем…" : "Проверить и импортировать"}
        </button>
      </form>
    </Modal>
  );
}

function CreateModal({
  catalog,
  close,
  saved,
}: {
  catalog: Catalog;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(""),
    [id, setID] = useState(""),
    [role, setRole] = useState(catalog.profiles[0].role),
    [grade, setGrade] = useState("Junior"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/hr/employees", {
        employee_id: id,
        full_name: name,
        department: role,
        role,
        grade,
        manager_id: null,
        hire_date: catalog.as_of,
        tenure_months: 0,
        work_format: "hybrid",
        preferred_language: "ru",
        career_goal: null,
        skills: {},
        last_review_date: catalog.as_of,
      });
      saved();
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Новый демо-сотрудник" close={close}>
      <p>
        Создаём профиль без оценки навыков. Пустой навык помечается «не оценён»,
        а не считается доказанной слабостью. Готовую оценку можно загрузить
        через импорт.
      </p>
      <form onSubmit={submit}>
        <label>
          Идентификатор
          <input
            value={id}
            onChange={(e) => setID(e.target.value)}
            placeholder="E0201"
            pattern="[A-Za-z0-9_-]{1,50}"
            required
          />
        </label>
        <label>
          Имя синтетического сотрудника
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={150}
            required
          />
        </label>
        <label>
          Роль
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {[...new Set(catalog.profiles.map((p) => p.role))].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Грейд
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            {["Junior", "Middle", "Senior", "Lead"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary-button full" disabled={busy}>
          Создать профиль
        </button>
      </form>
    </Modal>
  );
}

function ReviewModal({
  item,
  close,
  saved,
}: {
  item: Completion;
  close: () => void;
  saved: () => void;
}) {
  const [note, setNote] = useState(""),
    [decision, setDecision] = useState("approved"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/hr/completions/${item.id}/review`, { decision, note });
      saved();
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Проверка результата" close={close}>
      <h3>{item.title}</h3>
      <p>
        {item.full_name} · {dateText(item.completed_at)}
      </p>
      <blockquote>{item.evidence}</blockquote>
      <form onSubmit={submit}>
        <label>
          Решение
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          >
            <option value="approved">Подтвердить завершение</option>
            <option value="rejected">Не подтверждать</option>
          </select>
        </label>
        <label>
          Основание решения
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={3}
            maxLength={1000}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary-button full" disabled={busy}>
          <ShieldCheck size={16} /> Сохранить решение
        </button>
      </form>
    </Modal>
  );
}
