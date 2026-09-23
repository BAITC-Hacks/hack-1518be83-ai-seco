import { StrictMode, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Flag,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  Link2,
  LogOut,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
  Clock3,
  Plus,
} from "lucide-react";
import { api, post } from "./api";
import type {
  Catalog,
  Completion,
  Overview,
  Profile,
  Quest,
  User,
} from "./types";
import "./style.css";

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
  },
});
const formats: Record<string, string> = {
  online: "Онлайн",
  offline: "Очно",
  self_paced: "В своём темпе",
};
const statuses: Record<string, string> = {
  completed: "Завершено",
  in_progress: "В процессе",
  dropped: "Не завершено",
  declined: "Отказ",
  no_show: "Неявка",
  overdue: "Просрочено",
  pending: "Проверяет HR",
  approved: "Подтверждено",
  rejected: "Не подтверждено",
};
const dateText = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = dialog.current;
    const controls = () =>
      Array.from(
        target?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        ) ?? [],
      );
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={close}>
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Закрыть" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [role, setRole] = useState("employee"),
    [password, setPassword] = useState("careerquest-demo"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await post<User>("/auth/login", { username: role, password }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand">
          <Compass />
          <span>
            career<span className="brand-light">quest</span>
          </span>
        </div>
        <span className="eyebrow">ТВОЙ РОСТ. ТВОЙ МАРШРУТ.</span>
        <h1>
          Следующий шаг
          <br />
          имеет значение.
        </h1>
        <p>
          Превращаем разрозненные обучения в понятный путь к вашей карьерной
          цели.
        </p>
        <div className="login-route">
          <span>
            <Check size={18} /> Профиль
          </span>
          <i />
          <span>
            <Target size={18} /> Цель
          </span>
          <i />
          <span>
            <Flag size={18} /> Новый уровень
          </span>
        </div>
        <small>AI-SECO · Halyk Bank case · HackAlem AI</small>
      </section>
      <section className="login-panel">
        <span className="badge">Демо · синтетические данные</span>
        <h2>Добро пожаловать</h2>
        <p>Посмотрите на развитие со своей стороны.</p>
        <form onSubmit={login}>
          <div className="role-choice">
            <button
              type="button"
              className={role === "employee" ? "selected" : ""}
              onClick={() => setRole("employee")}
            >
              <GraduationCap />
              <strong>Сотрудник</strong>
              <small>Мой карьерный путь</small>
            </button>
            <button
              type="button"
              className={role === "hr" ? "selected" : ""}
              onClick={() => setRole("hr")}
            >
              <Users />
              <strong>HR-партнёр</strong>
              <small>Развитие команды</small>
            </button>
          </div>
          <label>
            Пароль демо-аккаунта
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "Входим…" : "Открыть пространство"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <span>
            Личный профиль доступен сотруднику и HR. Никаких публичных
            рейтингов.
          </span>
        </div>
        <small>
          Локальный прототип. Демо-аккаунты не предназначены для публичного
          размещения.
        </small>
      </section>
    </div>
  );
}

function App() {
  const cache = useQueryClient();
  const session = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/me"),
  });
  const user = session.data;
  const [tab, setTab] = useState("path"),
    [selected, setSelected] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<Catalog>("/catalog"),
    enabled: !!user,
  });
  if (session.isPending)
    return <div className="loading">Открываем Career Quest…</div>;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          cache.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
          cache.setQueryData(["me"], u);
          setTab(u.role === "hr" ? "team" : "path");
          setSelected(null);
        }}
      />
    );
  const isHR = user.role === "hr";
  const eid = isHR ? selected : user.employee_id;
  async function logout() {
    await post("/auth/logout");
    cache.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    cache.setQueryData(["me"], null);
    setSelected(null);
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          aria-label="Career Quest — главная"
          onClick={() => {
            setTab(isHR ? "team" : "path");
            setSelected(null);
          }}
        >
          <Compass />
          <span>
            career<span className="brand-light">quest</span>
          </span>
        </a>
        <div className="workspace">
          <span className="bank-mark">H</span>
          <div>
            <strong>Halyk Bank</strong>
            <small>Пространство развития</small>
          </div>
          <span className="dot" />
        </div>
        <span className="nav-label">МОЁ ПРОСТРАНСТВО</span>
        <nav>
          {(isHR
            ? [
                ["team", Users, "Команда"],
                ["connections", Link2, "Интеграции"],
              ]
            : [
                ["path", Compass, "Мой карьерный путь"],
                ["skills", LayoutDashboard, "Мои навыки"],
                ["history", BookOpen, "История развития"],
                ["connections", Link2, "Интеграции"],
              ]
          ).map(([key, Icon, label]) => (
            <button
              key={String(key)}
              aria-label={String(label)}
              title={String(label)}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(String(key));
                setSelected(null);
              }}
            >
              {typeof Icon !== "string" && <Icon size={19} />}
              <span>{String(label)}</span>
              {tab === key && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="safe-note">
            <ShieldCheck size={21} />
            <strong>Рост без сравнения</strong>
            <p>Ваш путь — не соревнование с коллегами.</p>
          </div>
          <button
            className="account"
            onClick={logout}
            aria-label="Выйти из аккаунта"
            title="Выйти из аккаунта"
          >
            <span className="avatar">{isHR ? "HR" : "АЗ"}</span>
            <span>
              <strong>{isHR ? "HR-партнёр" : "Мой кабинет"}</strong>
              <small>Демо-аккаунт</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            Пространство развития <ChevronRight size={14} />{" "}
            <strong>{isHR ? "HR-обзор" : "Мой путь"}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-dot" />
            Демо · срез {catalog.data?.as_of ?? "…"}
            <span className="avatar small">{isHR ? "HR" : "АЗ"}</span>
          </div>
        </header>
        <main>
          {catalog.isError ? (
            <p className="error">{errorText(catalog.error)}</p>
          ) : catalog.data ? (
            tab === "connections" ? (
              <Connections />
            ) : isHR && !selected ? (
              <HR
                catalog={catalog.data}
                onSelect={(id) => {
                  setSelected(id);
                  setTab("team");
                }}
              />
            ) : eid ? (
              <ProfileView
                eid={eid}
                catalog={catalog.data}
                tab={isHR ? "path" : tab}
                isHR={isHR}
                onBack={() => setSelected(null)}
              />
            ) : null
          ) : (
            <div className="loading">Загружаем каталог…</div>
          )}
        </main>
      </div>
    </div>
  );
}

function ProfileView({
  eid,
  catalog,
  tab,
  isHR,
  onBack,
}: {
  eid: string;
  catalog: Catalog;
  tab: string;
  isHR: boolean;
  onBack: () => void;
}) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["profile", eid],
    queryFn: () => api<Profile>(`/employees/${eid}`),
  });
  const [goalOpen, setGoalOpen] = useState(false),
    [completion, setCompletion] = useState<{
      event_id: string;
      title: string;
    } | null>(null),
    [explanations, setExplanations] = useState<Record<string, string>>({}),
    [aiMessage, setAIMessage] = useState(""),
    [aiBusy, setAIBusy] = useState(false);
  if (query.isPending)
    return <div className="loading">Собираем ваш маршрут…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const p = query.data,
    e = p.employee,
    goal = e.career_goal;
  const completed = p.history.filter((r) => r.status === "completed").length;
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
    } catch (e) {
      setAIMessage(errorText(e));
    } finally {
      setAIBusy(false);
    }
  }
  function refresh() {
    setExplanations({});
    void cache.invalidateQueries({ queryKey: ["profile", eid] });
    void cache.invalidateQueries({ queryKey: ["hr"] });
  }
  return (
    <>
      {isHR && (
        <button className="text-button back" onClick={onBack}>
          ← К команде
        </button>
      )}
      <div className="page-title">
        <div>
          <span className="eyebrow">
            {e.role.toUpperCase()} · {e.grade.toUpperCase()}
          </span>
          <h1>
            {isHR
              ? e.full_name
              : `Ваш следующий шаг, ${e.full_name.split(" ")[0]}`}
          </h1>
          <p>Небольшие действия сегодня. Новые возможности завтра.</p>
        </div>
        <span className="outlined-pill">
          <ShieldCheck size={15} /> Личный профиль
        </span>
      </div>
      {tab === "path" && (
        <>
          <section className="journey-hero">
            <div className="hero-copy">
              <span className="hero-tag">
                <Target size={15} /> ВАША КАРЬЕРНАЯ ЦЕЛЬ
              </span>
              <h2>
                {goal
                  ? `${goal.target_grade} ${goal.target_role}`
                  : "Каким будет ваш следующий шаг?"}
              </h2>
              <p>
                {goal
                  ? "Мы связали требования роли с вашими навыками. Выбирайте подходящий темп — каждый подтверждённый шаг меняет маршрут."
                  : "Выберите направление развития. Мы не назначаем цель за вас и не считаем отсутствие цели недостатком."}
              </p>
              <button className="hero-button" onClick={() => setGoalOpen(true)}>
                {goal ? "Изменить цель" : "Выбрать цель"}
                <ArrowRight size={16} />
              </button>
            </div>
            <div
              className="progress-ring"
              style={
                { "--progress": `${p.readiness ?? 0}%` } as React.CSSProperties
              }
            >
              <div>
                <strong>
                  {p.readiness ?? "—"}
                  {p.readiness !== null && <small>%</small>}
                </strong>
                <span>покрытие требований</span>
              </div>
            </div>
            <div className="journey-footer">
              <span>
                <span className="route-dot" /> Сейчас: {e.grade}
              </span>
              <div className="route-line">
                <i />
              </div>
              <span>
                <Flag size={14} /> {goal?.target_grade ?? "Цель не выбрана"}
              </span>
            </div>
          </section>
          <section className="stats-grid">
            <Stat
              label="Подтверждено в истории"
              value={String(completed)}
              note="завершённых активностей"
              icon={<BookOpen />}
            />
            <Stat
              label="Навыки для цели"
              value={String(p.gaps.filter((g) => g.gap === 0).length)}
              note={`из ${p.gaps.length} соответствуют требованиям`}
              icon={<Target />}
            />
            <Stat
              label="Ближайшие возможности"
              value={String(p.recommendations.length)}
              note="подходящих шагов развития"
              icon={<Compass />}
            />
          </section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">ОТ ЦЕЛИ К ДЕЙСТВИЮ</span>
              <h2>Рекомендовано для вашего роста</h2>
              <p>Не просто курс — конкретный шаг к выбранной роли.</p>
            </div>
            <button
              className="secondary"
              onClick={askAI}
              disabled={aiBusy || !p.recommendations.length}
            >
              <Sparkles size={16} />
              {aiBusy
                ? "AI объясняет…"
                : catalog.ai_available
                  ? "Объяснить с AI"
                  : "Проверить AI-подключение"}
            </button>
          </div>
          <div className="mode-note">
            <span className="tiny-dot" />
            {aiMessage ||
              "Проверяемый подбор по правилам · AI-объяснение пока не запрошено"}
          </div>
          <div className="quest-grid">
            {p.recommendations.map((q, i) => (
              <QuestCard
                key={q.event_id}
                quest={q}
                index={i}
                explanation={explanations[q.event_id]}
                onComplete={() => setCompletion(q)}
                canComplete={q.format === "self_paced"}
              />
            ))}
          </div>
          {!p.recommendations.length && (
            <div className="empty">
              {goal
                ? "Сейчас нет подходящих шагов в каталоге. Обсудите с HR новые обучения или наставничество."
                : "Выберите карьерную цель — и здесь появятся подходящие активности."}
            </div>
          )}
          <div className="lower-grid">
            <section className="panel">
              <div className="panel-title">
                <h2>Фокус развития</h2>
                <span className="badge">До целевой роли</span>
              </div>
              <Skills gaps={p.gaps.slice(0, 5)} />
              <p className="footnote">
                Приоритет отмечает важность навыка для роли, а не вашу ценность
                как сотрудника.
              </p>
            </section>
            <section className="panel path-note">
              <div className="icon-tile">
                <GitBranch />
              </div>
              <h2>
                Навык — больше,
                <br />
                чем пройденный курс
              </h2>
              <p>
                Завершение подтверждает HR. Прирост рассчитывается по правилам
                каталога. Для перехода на грейд нужна отдельная оценка.
              </p>
              <div className="mini-flow">
                <span>Практика</span>
                <ChevronRight size={14} />
                <span>Проверка</span>
                <ChevronRight size={14} />
                <span>Рост</span>
              </div>
              <small>
                Анализ Git, Confluence и рабочих задач — следующий этап, пока не
                подключён.
              </small>
            </section>
          </div>
        </>
      )}
      {tab === "skills" && (
        <section className="panel">
          <div className="panel-title">
            <h2>Матрица навыков</h2>
            <button className="secondary" onClick={() => setGoalOpen(true)}>
              Изменить цель
            </button>
          </div>
          <Skills gaps={p.gaps} />
          {!p.gaps.length && (
            <p>Сначала выберите цель, чтобы увидеть требования.</p>
          )}
        </section>
      )}
      {(tab === "history" || tab === "path") && (
        <section className="panel history-panel">
          <div className="panel-title">
            <h2>
              {tab === "history" ? "История развития" : "Последние активности"}
            </h2>
            <span className="muted">Срез {dateText(p.as_of)}</span>
          </div>
          {p.completions.map((c) => (
            <div className="history-row" key={c.id}>
              <span className="history-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <strong>{c.title}</strong>
                <small>
                  {c.review_note || "Навыки изменятся только после проверки HR"}
                </small>
              </div>
              <span className={`status ${c.status}`}>{statuses[c.status]}</span>
            </div>
          ))}
          {p.history.slice(0, tab === "history" ? 100 : 4).map((h) => (
            <div className="history-row" key={h.record_id}>
              <span className="history-icon">
                <BookOpen size={18} />
              </span>
              <div>
                <strong>{h.title}</strong>
                <small>
                  {dateText(h.date)}
                  {h.format === "self_paced"
                    ? " · дата зачисления в исходной истории"
                    : ""}
                </small>
              </div>
              <span className={`status ${h.status}`}>{statuses[h.status]}</span>
              {h.status === "in_progress" && (
                <button
                  className="text-button"
                  onClick={() => setCompletion(h)}
                >
                  Подтвердить
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <p className="footnote page-footnote">
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

function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}
function Skills({ gaps }: { gaps: Profile["gaps"] }) {
  return (
    <div className="skills-list">
      {gaps.map((g) => (
        <div className="skill-row" key={g.skill_id}>
          <div>
            <strong>{g.name}</strong>
            {g.critical && <span className="priority">Приоритет</span>}
            <span className="skill-value">
              {g.assessed ? g.current : "Не оценён"} <span>/ {g.required}</span>
            </span>
          </div>
          <div className="skill-track">
            <i
              style={{ width: `${Math.min(g.current / g.required, 1) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function QuestCard({
  quest: q,
  index,
  explanation,
  onComplete,
  canComplete,
}: {
  quest: Quest;
  index: number;
  explanation?: string;
  onComplete: () => void;
  canComplete: boolean;
}) {
  return (
    <article className="quest-card">
      <div className="quest-top">
        <span className="quest-number">0{index + 1}</span>
        <span className="badge">
          {q.benefits.some((b) => b.critical)
            ? "Ключевой навык"
            : "Развитие навыков"}
        </span>
      </div>
      <h3>{q.title}</h3>
      <div className="quest-meta">
        <span>
          <Clock3 size={14} />
          {q.duration_hours} ч
        </span>
        <span>{formats[q.format]}</span>
      </div>
      <p>{explanation || q.reason}</p>
      <div className="benefits">
        {q.benefits.slice(0, 3).map((b) => (
          <span key={b.name}>
            {b.name}
            <strong>
              {b.from} → {b.to}
            </strong>
          </span>
        ))}
      </div>
      {q.past_misses > 0 && (
        <small className="history-hint">
          В истории есть {q.past_misses} незавершённых участий/отказов за 180
          дней. Стоит обсудить формат.
        </small>
      )}
      <footer>
        <small>
          {q.next_session
            ? `Ближайшая сессия: ${dateText(q.next_session)}`
            : "Можно учиться в своём темпе"}
        </small>
        <button
          className="card-button"
          onClick={onComplete}
          disabled={!canComplete}
        >
          {canComplete ? "Сообщить о завершении" : "Завершение после сессии"}
          <ArrowRight size={16} />
        </button>
      </footer>
    </article>
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
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Ваша карьерная цель" close={close}>
      <p>
        Можно развиваться в текущей роли или выбрать новое направление. Цель —
        ваш выбор.
      </p>
      <form onSubmit={save}>
        <label>
          Направление
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {[...new Set(catalog.profiles.map((p) => p.role))].map((r) => (
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
        <button className="primary full" disabled={busy}>
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
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Подтверждение завершения" close={close}>
      <p>{event.title}</p>
      <div className="callout">
        Это заявка на проверку HR. До подтверждения навыки не изменятся. Награды
        в этой версии ещё не выдаются.
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
        <button className="primary full" disabled={busy}>
          Отправить HR
        </button>
      </form>
    </Modal>
  );
}

function HR({
  catalog,
  onSelect,
}: {
  catalog: Catalog;
  onSelect: (id: string) => void;
}) {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ["hr"],
      queryFn: () => api<Overview>("/hr/overview"),
    });
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("Все роли"),
    [importOpen, setImportOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false),
    [review, setReview] = useState<Completion | null>(null);
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["hr"] });
    void cache.invalidateQueries({ queryKey: ["profile"] });
  };
  if (q.isPending)
    return <div className="loading">Собираем обзор команды…</div>;
  if (q.isError) return <p className="error">{errorText(q.error)}</p>;
  const d = q.data,
    rows = d.employees.filter(
      (e) =>
        (filter === "Все роли" || filter === e.role) &&
        `${e.full_name} ${e.role} ${e.employee_id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">ЛЮДИ И ВОЗМОЖНОСТИ</span>
          <h1>Развитие команды</h1>
          <p>Помогайте двигаться вперёд — без ярлыков и публичных рейтингов.</p>
        </div>
        <div className="button-group">
          <button className="secondary" onClick={() => setImportOpen(true)}>
            <ArrowDownToLine size={16} />
            Импорт
          </button>
          <button className="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Сотрудник
          </button>
        </div>
      </div>
      <section className="stats-grid">
        <Stat
          label="В пространстве"
          value={String(d.total)}
          note="синтетических профилей"
          icon={<Users />}
        />
        <Stat
          label="Без выбранной цели"
          value={String(d.without_goal)}
          note="предложить карьерный разговор"
          icon={<Compass />}
        />
        <Stat
          label="Ожидают проверки"
          value={String(d.pending.length)}
          note="заявок о завершении"
          icon={<ShieldCheck />}
        />
      </section>
      {d.pending.length > 0 && (
        <section className="panel">
          <h2>Ожидают вашего решения</h2>
          {d.pending.map((c) => (
            <div className="history-row" key={c.id}>
              <span className="history-icon">
                <ShieldCheck />
              </span>
              <div>
                <strong>
                  {c.full_name} · {c.title}
                </strong>
                <small>{c.evidence}</small>
              </div>
              <button className="secondary" onClick={() => setReview(c)}>
                Рассмотреть
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="hr-grid">
        <section className="panel">
          <h2>Частые разрывы до целей</h2>
          <p className="muted">
            Число сотрудников с выбранной целью и разрывом.
          </p>
          {d.gaps.map((g) => (
            <div className="aggregate" key={g.name}>
              <span>{g.name}</span>
              <div>
                <i style={{ width: `${(g.count / d.total) * 100}%` }} />
              </div>
              <strong>{g.count}</strong>
            </div>
          ))}
        </section>
        <section className="panel safety-panel">
          <ShieldCheck size={26} />
          <h2>Сигнал — повод поговорить</h2>
          <p>
            Пропуски и отсутствие записей не объясняют причины. Уточните
            нагрузку, доступность и актуальность цели.
          </p>
          <small>
            Срок на грейде не рассчитан: в датасете нет даты перехода. Стаж
            работы не подменяет её.
          </small>
        </section>
      </div>
      <section className="panel table-panel">
        <div className="panel-title">
          <h2>
            Сотрудники <span className="count">{rows.length}</span>
          </h2>
          <div className="table-filters">
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Поиск сотрудников"
                placeholder="Имя, роль или ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Фильтр по роли"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option>Все роли</option>
              {[...new Set(d.employees.map((e) => e.role))].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Роль и грейд</th>
                <th>Цель / покрытие</th>
                <th>Наблюдения</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.employee_id}>
                  <td>
                    <strong>{e.full_name}</strong>
                    <small>{e.employee_id}</small>
                  </td>
                  <td>
                    {e.role}
                    <small>{e.grade}</small>
                  </td>
                  <td>
                    {e.goal
                      ? `${e.goal.target_grade} · ${e.readiness}%`
                      : "Не выбрана"}
                  </td>
                  <td>
                    {e.signals.length ? (
                      e.signals.map((s) => (
                        <span className="signal" key={s}>
                          {s}
                        </span>
                      ))
                    ) : (
                      <span className="muted">
                        Нет сигналов по текущим правилам
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Открыть ${e.full_name}`}
                      onClick={() => onSelect(e.employee_id)}
                    >
                      <ArrowRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="empty">По вашему запросу никто не найден.</div>
        )}
      </section>
      {importOpen && (
        <ImportModal close={() => setImportOpen(false)} saved={refresh} />
      )}{" "}
      {createOpen && (
        <CreateModal
          catalog={catalog}
          close={() => setCreateOpen(false)}
          saved={refresh}
        />
      )}{" "}
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
          className="primary full"
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
        Создаём профиль без оценки навыков. Пустой навык будет помечен «не
        оценён», а не считаться доказанной слабостью. Готовую оценку можно
        загрузить в составе нового профиля через импорт.
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
        <button className="primary full" disabled={busy}>
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
        <button className="primary full" disabled={busy}>
          Сохранить решение
        </button>
      </form>
    </Modal>
  );
}
function Connections() {
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">СЛЕДУЮЩИЙ ЭТАП</span>
          <h1>Навыки из реальной работы</h1>
          <p>
            Архитектура интеграций согласована. Подключений к рабочим системам
            пока нет.
          </p>
        </div>
        <span className="badge">В разработке</span>
      </div>
      <div className="quest-grid">
        {[
          [
            "GitHub / GitLab",
            "Изменения кода, тесты и замечания ревью — вместе с контекстом задачи.",
          ],
          [
            "Confluence",
            "Качество постановки, критерии приёмки и согласования документов.",
          ],
          [
            "Jira / учёт времени",
            "Сложность задачи, блокировки и этапы работы. Часы сами по себе не оценивают навык.",
          ],
        ].map(([name, description]) => (
          <section className="panel" key={name}>
            <span className="icon-tile">
              <Link2 />
            </span>
            <h2>{name}</h2>
            <p>{description}</p>
            <span className="status">Не подключено</span>
          </section>
        ))}
      </div>
      <section className="panel safety-panel">
        <ShieldCheck />
        <h2>AI предлагает наблюдение. Человек подтверждает вывод.</h2>
        <p>
          Доступ только на чтение, привязка к сотруднику по подтверждённому
          идентификатору, ссылка на исходный рабочий пример и право оспорить
          оценку. Банковские, клиентские данные и секреты не отправляются во
          внешнюю модель автоматически.
        </p>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
