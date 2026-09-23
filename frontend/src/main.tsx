import { StrictMode, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Compass,
  GraduationCap,
  LayoutDashboard,
  Link2,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, post } from "./api";
import { Connections } from "./connections";
import { Learning, ProfileView } from "./profile";
import { EmployeeCard, People, TeamDashboard } from "./team";
import type { Queue, TeamFilter } from "./team";
import type { Catalog, Role, User } from "./types";
import { ToastProvider, errorText, initials } from "./ui";
import "./style.css";

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
  },
});

type View = "summary" | "people" | "route" | "learning" | "connections";
const NAV: Record<Role, [View, LucideIcon, string][]> = {
  hr: [
    ["summary", LayoutDashboard, "Общая сводка"],
    ["people", Users, "Сотрудники"],
  ],
  manager: [
    ["summary", LayoutDashboard, "Сводка отдела"],
    ["people", Users, "Мой отдел"],
  ],
  employee: [
    ["route", Compass, "Мой маршрут"],
    ["learning", BookOpen, "Моё обучение"],
    ["connections", Link2, "Подключения"],
  ],
};
const TITLES: Record<View, Record<Role, string>> = {
  summary: {
    hr: "Сводка по всем сотрудникам",
    manager: "Аналитика моего отдела",
    employee: "",
  },
  people: {
    hr: "Все сотрудники",
    manager: "Сотрудники моего отдела",
    employee: "",
  },
  route: {
    hr: "Профиль сотрудника",
    manager: "Профиль сотрудника",
    employee: "Мой маршрут развития",
  },
  learning: { hr: "", manager: "", employee: "Моё обучение" },
  connections: { hr: "", manager: "", employee: "Мои GitHub и Jira" },
};
const ROLES: [Role, LucideIcon, string, string][] = [
  ["employee", GraduationCap, "Сотрудник", "Мой маршрут"],
  ["manager", Briefcase, "Руководитель", "Мой отдел"],
  ["hr", Users, "HR-партнёр", "Вся компания"],
];

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [role, setRole] = useState<Role>("employee"),
    [password, setPassword] = useState("careerquest-demo"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await post<User>("/auth/login", { username: role, password }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">CQ</span>
          <span>
            Career <strong>Quest</strong>
            <small>Развитие сотрудников</small>
          </span>
        </div>
        <p className="section-kicker">HACKALEM AI · HALYK BANK</p>
        <h1>
          Кто где сейчас.
          <br />
          Куда двигаться дальше.
        </h1>
        <p>
          Навыки, обучение и рабочий контекст из Jira и GitHub — в понятный
          маршрут для сотрудника и прозрачную картину для HR и руководителя.
        </p>
        <div className="login-route">
          <span>Профиль</span>
          <i />
          <span>Разрывы</span>
          <i />
          <span>Следующий шаг</span>
        </div>
        <small>Синтетические данные · срез 01.10.2026</small>
      </section>
      <section className="login-panel">
        <span className="demo-tag">ДЕМО · СИНТЕТИЧЕСКИЕ ДАННЫЕ</span>
        <h2>Вход в кабинет</h2>
        <p className="muted">Выберите роль демо-аккаунта.</p>
        <form onSubmit={login}>
          <div className="role-choice">
            {ROLES.map(([key, Icon, title, note]) => (
              <button
                type="button"
                key={key}
                className={role === key ? "selected" : ""}
                aria-pressed={role === key}
                onClick={() => setRole(key)}
              >
                <Icon size={20} />
                <strong>{title}</strong>
                <small>{note}</small>
              </button>
            ))}
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
          <button className="primary-button full" disabled={busy}>
            {busy ? "Входим…" : "Открыть кабинет"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <span>
            Сотрудник видит только себя, руководитель — свой отдел, HR — всех.
            Публичных рейтингов нет. Права проверяет сервер.
          </span>
        </div>
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
  const [view, setView] = useState<View>("summary"),
    [profile, setProfile] = useState<string | null>(null),
    [card, setCard] = useState<string | null>(null),
    [filter, setFilter] = useState<TeamFilter>({ department: "", role: "" }),
    [queue, setQueue] = useState<Queue>("all");
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
          setView(u.role === "employee" ? "route" : "summary");
          setProfile(null);
          setCard(null);
          setFilter({ department: "", role: "" });
          setQueue("all");
        }}
      />
    );
  const staff = user.role !== "employee";
  const allowed = NAV[user.role].map(([key]) => key);
  const current = allowed.includes(view) ? view : allowed[0];
  async function logout() {
    await post("/auth/logout");
    cache.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    cache.setQueryData(["me"], null);
  }
  function go(next: View) {
    setView(next);
    setProfile(null);
  }
  const scope =
    user.role === "hr"
      ? ["Кабинет HR", "Все отделы и сотрудники"]
      : user.role === "manager"
        ? [
            `${user.full_name} · Руководитель`,
            `${user.department} · только свой отдел`,
          ]
        : [
            `${user.full_name} · Сотрудник`,
            "Мои навыки, обучение и рабочие инструменты",
          ];
  const title = profile ? TITLES.route[user.role] : TITLES[current][user.role];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CQ</span>
          <span>
            Career <strong>Quest</strong>
            <small>Развитие сотрудников</small>
          </span>
        </div>
        <div className="role-card">
          <span className="role-label">
            {user.role === "hr"
              ? "HR"
              : user.role === "manager"
                ? "РУКОВОДИТЕЛЬ"
                : "СОТРУДНИК"}
          </span>
          <b>{user.full_name ?? "Все отделы"}</b>
          <small>{scope[1]}</small>
        </div>
        <nav className="nav" aria-label="Разделы">
          {NAV[user.role].map(([key, Icon, label]) => (
            <button
              key={key}
              className={`nav-item ${current === key && !profile ? "active" : ""}`}
              aria-current={current === key && !profile ? "page" : undefined}
              onClick={() => go(key)}
            >
              <Icon size={19} className="nav-symbol" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-dot" />
          <span>
            Демонстрация на синтетических данных
            <br />
            <b>Срез: 01.10.2026</b>
          </span>
        </div>
        <button
          className="account"
          onClick={logout}
          aria-label="Выйти из аккаунта"
        >
          <span className="avatar">
            {user.full_name ? initials(user.full_name) : "HR"}
          </span>
          <span>
            <b>{user.full_name ?? "HR-партнёр"}</b>
            <small>Выйти</small>
          </span>
          <LogOut size={17} />
        </button>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div>
            <p className="section-kicker">HACKALEM AI · HALYK BANK</p>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            <span className="data-pill">● Стартовый датасет + импорт</span>
            <span className="avatar">
              {user.full_name ? initials(user.full_name) : "HR"}
            </span>
          </div>
        </header>
        <main>
          <div className="role-scope">
            <b>{scope[0]}</b>
            <span>{scope[1]}</span>
            <small>Права проверяются сервером на каждом запросе.</small>
          </div>
          {catalog.isError ? (
            <p className="error">{errorText(catalog.error)}</p>
          ) : !catalog.data ? (
            <div className="loading">Загружаем каталог…</div>
          ) : staff && profile ? (
            <ProfileView
              eid={profile}
              catalog={catalog.data}
              viewer={user.role === "hr" ? "hr" : "manager"}
              onBack={() => setProfile(null)}
            />
          ) : current === "summary" ? (
            <TeamDashboard
              user={user}
              catalog={catalog.data}
              filter={filter}
              setFilter={setFilter}
              openPeople={(q) => {
                setQueue(q);
                go("people");
              }}
              openCard={setCard}
            />
          ) : current === "people" ? (
            <People
              user={user}
              filter={filter}
              setFilter={setFilter}
              queue={queue}
              setQueue={setQueue}
              openCard={setCard}
            />
          ) : !user.employee_id ? null : current === "learning" ? (
            <Learning eid={user.employee_id} />
          ) : current === "connections" ? (
            <Connections eid={user.employee_id} />
          ) : (
            <ProfileView
              eid={user.employee_id}
              catalog={catalog.data}
              viewer="self"
              openLearning={() => go("learning")}
            />
          )}
        </main>
      </div>
      {card && (
        <EmployeeCard
          eid={card}
          close={() => setCard(null)}
          openProfile={(eid) => {
            setCard(null);
            setProfile(eid);
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
