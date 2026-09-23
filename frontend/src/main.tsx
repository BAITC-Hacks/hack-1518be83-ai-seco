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
  GitPullRequest,
  Gift,
  GraduationCap,
  LayoutDashboard,
  Link2,
  LogOut,
  Search,
  ShieldCheck,
  Target,
  Users,
  X,
  Plus,
} from "lucide-react";
import { api, post } from "./api";
import { AIRecommendations } from "./AIRecommendations";
import {
  DevelopmentPanel,
  LearningPanel,
  PolicyForm,
  planLabels,
} from "./Development";
import { Integrations } from "./Integrations";
import { AssessmentForm, CreateEmployeeForm } from "./OnboardingForms";
import { EvidenceHRPanel, WorkEvidencePanel } from "./WorkEvidence";
import { ActivitiesPanel, AIBriefing, NoStepPanel } from "./HRInsights";
import { CatalogPage, QuizPanel } from "./Catalog";
import { ReassessmentPanel } from "./Reassessment";
import { HRRewardsPage, RewardsPage } from "./Rewards";
import type { Catalog, Completion, Overview, Profile, User } from "./types";
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
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
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
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="overlay" onClick={close}>
      <section
        ref={dialog}
        className={`modal${wide ? " modal-wide" : ""}`}
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
    [username, setUsername] = useState("employee"),
    [hrUser, setHRUser] = useState("hr"),
    [password, setPassword] = useState("careerquest-demo"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await post<User>("/auth/login", {
          username:
            role === "hr" ? hrUser : role === "manager" ? "manager" : username,
          password,
        }),
      );
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
            <button
              type="button"
              className={role === "manager" ? "selected" : ""}
              onClick={() => setRole("manager")}
            >
              <ShieldCheck />
              <strong>Руководитель</strong>
              <small>Мой отдел</small>
            </button>
          </div>
          {role === "hr" && (
            <label>
              Логин HR
              <input
                value={hrUser}
                onChange={(e) => setHRUser(e.target.value)}
                autoComplete="username"
                maxLength={80}
                required
              />
              <small>
                Демо: hr или expert — второй HR-эксперт для проверки курсов,
                аттестаций и наград.
              </small>
            </label>
          )}
          {role === "employee" && (
            <label>
              Логин сотрудника
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                maxLength={80}
                required
              />
              <small>
                Демо: employee. Для нового профиля — логин, выданный HR.
              </small>
            </label>
          )}
          <label>
            Пароль
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
            Личный профиль доступен сотруднику, HR и руководителю в пределах его
            отдела. Никаких публичных рейтингов.
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
          setTab(u.role !== "employee" ? "team" : "path");
          setSelected(null);
        }}
      />
    );
  const isHR = user.role === "hr";
  const isManager = user.role === "manager";
  const isLead = isHR || isManager;
  const eid = isLead ? selected : user.employee_id;
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
            setTab(isLead ? "team" : "path");
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
          {(isLead
            ? [
                ["team", Users, isHR ? "Команда" : "Мой отдел"],
                ...(isHR
                  ? [
                      ["catalog", GraduationCap, "Каталог и тесты"],
                      ["rewards", Gift, "Награды"],
                    ]
                  : []),
                ["connections", Link2, "Интеграции"],
              ]
            : [
                ["path", Compass, "Мой карьерный путь"],
                ["skills", LayoutDashboard, "Мои навыки"],
                ["learning", GraduationCap, "Моё обучение"],
                ["history", BookOpen, "История развития"],
                ["evidence", GitPullRequest, "Рабочие примеры"],
                ["rewards", Gift, "Награды"],
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
            <span className="avatar">
              {isHR ? "HR" : user.username.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>
                {isHR
                  ? "HR-партнёр"
                  : isManager
                    ? "Руководитель"
                    : "Мой кабинет"}
              </strong>
              <small>{user.username}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            Пространство развития <ChevronRight size={14} />{" "}
            <strong>
              {isHR ? "HR-обзор" : isManager ? "Обзор отдела" : "Мой путь"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="demo-dot" />
            Демо · срез {catalog.data?.as_of ?? "…"}
            <span className="avatar small">
              {isHR ? "HR" : user.username.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main>
          {catalog.isError ? (
            <p className="error">{errorText(catalog.error)}</p>
          ) : catalog.data ? (
            tab === "connections" ? (
              isHR ? (
                <Integrations />
              ) : (
                <Connections />
              )
            ) : tab === "rewards" && isHR ? (
              <HRRewardsPage catalog={catalog.data} />
            ) : tab === "rewards" && !isLead && user.employee_id ? (
              <RewardsPage eid={user.employee_id} />
            ) : tab === "catalog" && isHR ? (
              <CatalogPage catalog={catalog.data} username={user.username} />
            ) : isLead && !selected ? (
              <HR
                isHR={isHR}
                catalog={catalog.data}
                onSelect={(id) => {
                  setSelected(id);
                  setTab("team");
                }}
              />
            ) : eid ? (
              <ProfileView
                key={eid}
                eid={eid}
                catalog={catalog.data}
                tab={isLead ? "path" : tab}
                isHR={isHR}
                isManager={isManager}
                username={user.username}
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
  isManager = false,
  username,
  onBack,
}: {
  eid: string;
  catalog: Catalog;
  tab: string;
  isHR: boolean;
  isManager?: boolean;
  username: string;
  onBack: () => void;
}) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["profile", eid],
    queryFn: () => api<Profile>(`/employees/${eid}`),
  });
  const [goalOpen, setGoalOpen] = useState(false),
    [assessmentOpen, setAssessmentOpen] = useState(false),
    [completion, setCompletion] = useState<{
      event_id: string;
      title: string;
    } | null>(null);
  if (query.isPending)
    return <div className="loading">Собираем ваш маршрут…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const p = query.data,
    e = p.employee,
    goal = e.career_goal;
  const completed = p.history.filter((r) => r.status === "completed").length;
  const needsAssessment = p.onboarding?.status === "pending_assessment";
  function refresh() {
    void cache.invalidateQueries({ queryKey: ["profile", eid] });
    void cache.invalidateQueries({ queryKey: ["hr"] });
  }
  return (
    <>
      {(isHR || isManager) && (
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
          {p.onboarding && (
            <p>
              {e.department}
              {p.onboarding.specialization
                ? ` · ${p.onboarding.specialization}`
                : ""}{" "}
              · Найм: {dateText(e.hire_date)}
            </p>
          )}
        </div>
        <span className="outlined-pill">
          <ShieldCheck size={15} /> Личный профиль
        </span>
      </div>
      {p.onboarding && (
        <section className="panel onboarding-panel">
          <div className="panel-title">
            <h2>
              {needsAssessment
                ? "Первичная оценка навыков"
                : "Исходная оценка подтверждена"}
            </h2>
            <span className="badge">
              {needsAssessment
                ? "Шаг 2 из 3"
                : goal
                  ? "Маршрут сформирован"
                  : "Следующий шаг — цель"}
            </span>
          </div>
          {needsAssessment ? (
            <>
              <p>
                Профиль создан, но навыки ещё не оценены. До оценки HR подбор
                обучения и назначение цели недоступны.
              </p>
              {isHR ? (
                <button
                  className="primary"
                  onClick={() => setAssessmentOpen(true)}
                >
                  Провести первичную оценку
                </button>
              ) : (
                <p>
                  HR проведёт интервью или проверит практическое задание и
                  зафиксирует результат.
                </p>
              )}
            </>
          ) : (
            p.assessment && (
              <>
                <p>
                  {dateText(p.assessment.assessed_on)} · Оценил:{" "}
                  {p.assessment.reviewer} · Навыков:{" "}
                  {p.assessment.ratings.length}
                </p>
                <p>{p.assessment.note}</p>
                <details className="assessment-details">
                  <summary>Основания оценок</summary>
                  {p.assessment.ratings.map((r) => (
                    <div key={r.skill_id}>
                      <strong>
                        {catalog.skills.find((s) => s.skill_id === r.skill_id)
                          ?.name ?? r.skill_id}{" "}
                        · {r.level}/5
                      </strong>
                      <p>{r.evidence}</p>
                    </div>
                  ))}
                </details>
                {!goal && (
                  <p>
                    {isHR
                      ? "Теперь задайте карьерную цель ниже — система подберёт подходящие обучения."
                      : "Оценка готова. Следующий шаг — назначение карьерной цели HR."}
                  </p>
                )}
              </>
            )
          )}
        </section>
      )}
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
                  : "Карьерная цель пока не задана"}
              </h2>
              <p>
                {goal
                  ? "Мы связали требования роли с вашими навыками. Выбирайте подходящий темп — каждый подтверждённый шаг меняет маршрут."
                  : isHR
                    ? "Обсудите направление развития с сотрудником и задайте цель. Отсутствие цели не считается недостатком."
                    : "Обсудите направление развития с HR. После назначения цели здесь появится ваш маршрут."}
              </p>
              {isHR && !needsAssessment ? (
                <button
                  className="hero-button"
                  onClick={() => setGoalOpen(true)}
                >
                  {goal ? "Изменить цель" : "Задать цель"}
                  <ArrowRight size={16} />
                </button>
              ) : isHR ? (
                <p>Сначала проведите первичную оценку навыков.</p>
              ) : (
                <p>
                  Цель задаёт и меняет только HR. Для изменения обратитесь к
                  HR-партнёру.
                </p>
              )}
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
          {p.onboarding && goal && p.gaps.some((g) => !g.assessed) && (
            <div className="callout">
              Оценено {p.gaps.filter((g) => g.assessed).length} из{" "}
              {p.gaps.length} навыков целевой роли. Общий процент пока не
              рассчитывается. Неизвестные навыки не считаются подтверждёнными
              дефицитами; рекомендации ниже опираются на оценённые навыки.
            </div>
          )}
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
              note={
                goal
                  ? `из ${p.gaps.length} соответствуют требованиям`
                  : "Цель ещё не задана"
              }
              icon={<Target />}
            />
            <Stat
              label="Ближайшие возможности"
              value={String(p.recommendations.length)}
              note="подходящих шагов развития"
              icon={<Compass />}
            />
          </section>
          <AIRecommendations
            key={JSON.stringify([eid, e.career_goal, p.recommendations])}
            eid={eid}
            quests={p.recommendations}
            available={catalog.ai_available}
            onComplete={isManager ? undefined : (q) => setCompletion(q)}
          />
          {!p.recommendations.length && (
            <div className="empty">
              {needsAssessment
                ? "Обучения появятся после первичной оценки и назначения цели HR."
                : goal
                  ? "Сейчас нет подходящих шагов в каталоге. Обсудите с HR новые обучения или наставничество."
                  : isHR
                    ? "Задайте карьерную цель сотрудника — и здесь появятся подходящие активности."
                    : "HR ещё не задал карьерную цель. Обсудите с ним направление развития."}
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
                Наблюдения по рабочим примерам (синтетический импорт Git,
                Confluence, Jira) подтверждает эксперт. Живые подключения —
                следующий этап.
              </small>
            </section>
          </div>
        </>
      )}
      {tab === "skills" && (
        <section className="panel">
          <div className="panel-title">
            <h2>Матрица навыков</h2>
            {isHR && !needsAssessment && (
              <button className="secondary" onClick={() => setGoalOpen(true)}>
                {goal ? "Изменить цель" : "Задать цель"}
              </button>
            )}
          </div>
          {!isHR && <p>Карьерную цель может изменить только HR.</p>}
          <Skills gaps={p.gaps} />
          {!p.gaps.length && (
            <p>
              {isHR
                ? "Задайте цель, чтобы увидеть требования."
                : "Требования появятся после назначения цели HR."}
            </p>
          )}
        </section>
      )}
      {tab === "path" && !isHR && !isManager && (
        <QuizPanel eid={eid} quests={p.recommendations} onDone={refresh} />
      )}
      {tab === "path" && (isHR || isManager) && (
        <AIBriefing
          eid={eid}
          quests={p.recommendations}
          available={catalog.ai_available}
        />
      )}
      {tab === "path" && (
        <DevelopmentPanel profile={p} editable={isHR} onSaved={refresh} />
      )}
      {(tab === "skills" || (tab === "path" && (isHR || isManager))) && (
        <ReassessmentPanel
          profile={p}
          catalog={catalog}
          isHR={isHR}
          username={username}
          onChanged={refresh}
        />
      )}
      {tab === "learning" && !isManager && (
        <LearningPanel profile={p} onComplete={setCompletion} />
      )}
      {(tab === "evidence" || (isHR && tab === "path")) && (
        <WorkEvidencePanel eid={eid} isHR={isHR} onChanged={refresh} />
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
                  {dateText(h.completed_at ?? h.date)}
                  {h.completed_at
                    ? " · дата завершения"
                    : h.format === "self_paced"
                      ? " · дата зачисления в исходной истории"
                      : ""}
                </small>
              </div>
              <span className={`status ${h.status}`}>{statuses[h.status]}</span>
              {h.status === "in_progress" && !isManager && (
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
        {p.notice} Длительность на текущем грейде:{" "}
        {p.grade_months !== null
          ? `${p.grade_months} мес., с ${dateText(p.grade_since!)}`
          : "нет данных."}
      </p>
      {isHR && assessmentOpen && needsAssessment && (
        <Modal
          title="Первичная оценка навыков"
          wide
          close={() => setAssessmentOpen(false)}
        >
          <AssessmentForm
            profile={p}
            catalog={catalog}
            saved={() => {
              setAssessmentOpen(false);
              refresh();
            }}
          />
        </Modal>
      )}
      {isHR && goalOpen && !needsAssessment && (
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
    <Modal title="Карьерная цель сотрудника" close={close}>
      <p>
        Только HR задаёт и меняет цель после обсуждения с сотрудником. Новое
        направление — план развития, а не автоматическая смена должности.
        Текущие роль, грейд и оценки навыков не изменятся.
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
  isHR,
  catalog,
  onSelect,
}: {
  isHR: boolean;
  catalog: Catalog;
  onSelect: (id: string) => void;
}) {
  const cache = useQueryClient(),
    q = useQuery({
      queryKey: ["hr", isHR],
      queryFn: () => api<Overview>("/team/overview"),
    });
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("Все роли"),
    [department, setDepartment] = useState("all"),
    [priority, setPriority] = useState("all"),
    [page, setPage] = useState(0),
    [policyOpen, setPolicyOpen] = useState(false),
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
        (department === "all" || department === e.department) &&
        (priority === "all" ||
          priority === e.priority ||
          (priority === "growth" && !!e.growth?.ready) ||
          (priority === "no_step" && !!e.no_step)) &&
        `${e.full_name} ${e.role} ${e.employee_id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pages - 1);
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">ЛЮДИ И ВОЗМОЖНОСТИ</span>
          <h1>{isHR ? "Развитие команды" : "Мой отдел"}</h1>
          <p>
            {isHR
              ? "Помогайте двигаться вперёд — без ярлыков и публичных рейтингов."
              : `${d.department} · Сервер ограничивает доступ вашим отделом. Изменения целей и оценки — у HR.`}
          </p>
        </div>
        {isHR && (
          <div className="button-group">
            <button className="secondary" onClick={() => setPolicyOpen(true)}>
              Настроить сигналы
            </button>
            <button className="secondary" onClick={() => setImportOpen(true)}>
              <ArrowDownToLine size={16} />
              Импорт
            </button>
            <button className="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              Сотрудник
            </button>
          </div>
        )}
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
          label={isHR ? "Ожидают проверки" : "С назначенной целью"}
          value={String(isHR ? d.pending.length : d.total - d.without_goal)}
          note={isHR ? "заявок о завершении" : "сотрудников вашего отдела"}
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
      <section className="priority-grid" aria-label="Очередь поддержки">
        {(["high", "medium", "planned"] as const).map((key) => (
          <button
            key={key}
            className={`priority-tile ${key} ${priority === key ? "selected" : ""}`}
            aria-pressed={priority === key}
            onClick={() => {
              setPriority(priority === key ? "all" : key);
              setPage(0);
            }}
          >
            <span>
              {{ high: "Высокий", medium: "Средний", planned: "Плановый" }[key]}{" "}
              приоритет помощи
            </span>
            <strong>{d.priorities[key]}</strong>
            <small>Показать сотрудников →</small>
          </button>
        ))}
        {(
          [
            ["growth", "Готовы к росту", d.growth_ready, "Обсудить переход →"],
            [
              "no_step",
              "Без рекомендованного шага",
              d.no_step,
              "Показать причины →",
            ],
          ] as const
        ).map(([key, label, count, hint]) => (
          <button
            key={key}
            className={`priority-tile ${key} ${priority === key ? "selected" : ""}`}
            aria-pressed={priority === key}
            onClick={() => {
              setPriority(priority === key ? "all" : key);
              setPage(0);
            }}
          >
            <span>{label}</span>
            <strong>{count}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </section>
      <p className="muted">
        Приоритет — очередь помощи, не рейтинг людей. Паузы и причины
        обсуждаются с сотрудником.
      </p>
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
                <i
                  style={{
                    width: `${d.total ? (g.count / d.total) * 100 : 0}%`,
                  }}
                />
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
            Срок на грейде показывается только при явно указанной HR дате. В
            исходном датасете её нет; стаж работы не подменяет дату перехода.
          </small>
        </section>
      </div>
      <div className="hr-grid">
        <NoStepPanel
          data={d}
          onFilter={() => {
            setPriority("no_step");
            setPage(0);
          }}
        />
        <section className="panel safety-panel">
          <Target size={26} />
          <h2>Готовы к росту: {d.growth_ready}</h2>
          <p>
            Балл = 100 × (0,35·готовность к цели + 0,25·закрытые критичные
            навыки + 0,15·прирост уровней за год + 0,15·запас по текущему грейду
            + 0,10·вовлечённость). От 65 — повод обсудить переход.
          </p>
          <small>
            Считается только при назначенной HR цели и полной оценке навыков.
            Это не решение о повышении.
          </small>
        </section>
      </div>
      <ActivitiesPanel activities={d.activities} />
      {isHR && <EvidenceHRPanel onSelect={onSelect} />}
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            {isHR && (
              <select
                aria-label="Фильтр по отделу"
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">Все отделы</option>
                {d.departments.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            )}
            <select
              aria-label="Приоритет помощи"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">Все приоритеты</option>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="planned">Плановый</option>
              <option value="growth">Готовы к росту</option>
              <option value="no_step">Без рекомендованного шага</option>
            </select>
            <select
              aria-label="Фильтр по роли"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
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
              {rows.slice(currentPage * 10, currentPage * 10 + 10).map((e) => (
                <tr key={e.employee_id}>
                  <td>
                    <strong>{e.full_name}</strong>
                    <small>
                      {e.employee_id} · {e.department}
                    </small>
                  </td>
                  <td>
                    {e.role}
                    <small>{e.grade}</small>
                    {e.grade_months !== null && (
                      <small>{e.grade_months} мес. на грейде</small>
                    )}
                  </td>
                  <td>
                    {e.goal
                      ? `${e.goal.target_grade} · ${e.readiness === null ? "нужна оценка" : `${e.readiness}%`}`
                      : "Не выбрана"}
                  </td>
                  <td>
                    <span className={`priority-badge ${e.priority}`}>
                      {
                        {
                          high: "Высокий",
                          medium: "Средний",
                          planned: "Плановый",
                        }[e.priority]
                      }{" "}
                      приоритет
                    </span>
                    {e.plan && (
                      <small>
                        {planLabels[e.plan.status]} · {e.plan.owner}
                        {e.plan.next_review_on
                          ? ` · ${dateText(e.plan.next_review_on)}`
                          : ""}
                      </small>
                    )}
                    {e.growth?.ready && (
                      <span className="priority-badge growth">
                        Готов к росту · {e.growth.score}/100
                      </span>
                    )}
                    {e.no_step && (
                      <small className="no-step">
                        Нет рекомендованного шага: {e.no_step.text}
                      </small>
                    )}
                    {!!e.mandatory_overdue && (
                      <small>
                        Обязательных назначений с истёкшим сроком:{" "}
                        {e.mandatory_overdue} (отдельный процесс)
                      </small>
                    )}
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
        <div className="pagination">
          <button
            className="secondary"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Назад
          </button>
          <span>
            Страница {currentPage + 1} из {pages} · {rows.length} сотрудников
          </span>
          <button
            className="secondary"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Далее
          </button>
        </div>
        {!rows.length && (
          <div className="empty">По вашему запросу никто не найден.</div>
        )}
      </section>
      {policyOpen && isHR && (
        <Modal
          title="Настройки сигналов поддержки"
          close={() => setPolicyOpen(false)}
        >
          <PolicyForm
            policy={d.policy}
            onSaved={() => {
              setPolicyOpen(false);
              refresh();
            }}
          />
        </Modal>
      )}
      {importOpen && isHR && (
        <ImportModal close={() => setImportOpen(false)} saved={refresh} />
      )}{" "}
      {createOpen && (
        <Modal title="Новый сотрудник" wide close={() => setCreateOpen(false)}>
          <CreateEmployeeForm
            catalog={catalog}
            saved={refresh}
            openProfile={(id) => {
              setCreateOpen(false);
              onSelect(id);
            }}
          />
        </Modal>
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
          <span className="eyebrow">РАБОЧИЕ ПРИМЕРЫ</span>
          <h1>Навыки из реальной работы</h1>
          <p>
            HR может подключить GitHub, Jira и Confluence только на чтение.
            Наблюдения о навыках появляются после привязки аккаунта, разметки
            замечаний и решения эксперта.
          </p>
        </div>
        <span className="badge">Управляет HR</span>
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
            <span className="status">Только чтение · подключает HR</span>
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
