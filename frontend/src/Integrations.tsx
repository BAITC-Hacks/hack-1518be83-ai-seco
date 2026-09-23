import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api, post } from "./api";

type Connection = {
  connection_id: string;
  source: "github" | "jira" | "confluence";
  scope: string;
  site_url: string;
  name: string;
  has_token: boolean;
  token_hint: string;
  last_sync: {
    at: string;
    ok: boolean;
    error?: string;
    seconds?: number;
    artifacts?: number;
    tasks?: number;
    findings?: number;
  } | null;
};
type Identities = {
  mapped: {
    source: string;
    external_id: string;
    employee_id: string;
    full_name: string;
    display_name: string;
  }[];
  unmatched: {
    source: string;
    external_id: string;
    display_name: string;
    items: number;
  }[];
};
type Criterion = {
  criterion_id: string;
  roles: string[];
  title: string;
};
type Pending = {
  artifact_id: string;
  artifact_title: string;
  url: string;
  source: string;
  author: string;
  employee_id: string | null;
  full_name: string | null;
  finding_id: string;
  reviewer: string;
  text: string;
  suggested_criterion: string | null;
  suggestion_reason: string;
};

const names: Record<string, string> = {
  github: "GitHub",
  jira: "Jira Cloud",
  confluence: "Confluence Cloud",
};
const scopeHint: Record<string, string> = {
  github: "owner/repository",
  jira: "Ключ проекта, например PAY",
  confluence: "Ключ пространства, например PROD",
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";
const time = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function Integrations() {
  const cache = useQueryClient();
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["connections"] });
    void cache.invalidateQueries({ queryKey: ["identities"] });
    void cache.invalidateQueries({ queryKey: ["findings"] });
    void cache.invalidateQueries({ queryKey: ["evidence"] });
    void cache.invalidateQueries({ queryKey: ["evidence-queue"] });
  };
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">РАБОЧИЕ СИСТЕМЫ · ТОЛЬКО ЧТЕНИЕ</span>
          <h1>Интеграции</h1>
          <p>
            Подключите GitHub, Jira и Confluence. Замечания ревью попадают в
            анализ только после привязки аккаунта и вашей разметки.
          </p>
        </div>
        <span className="outlined-pill">
          <ShieldCheck size={15} /> Токены не показываются
        </span>
      </div>
      <div className="flow-steps">
        {[
          "Подключить систему",
          "Синхронизировать",
          "Привязать аккаунты",
          "Разметить замечания",
          "Проанализировать в профиле",
        ].map((step, i) => (
          <span key={step}>
            <b>{i + 1}</b> {step}
          </span>
        ))}
      </div>
      <ConnectionsPanel refresh={refresh} />
      <IdentitiesPanel refresh={refresh} />
      <FindingsPanel refresh={refresh} />
      <section className="panel safety-panel">
        <ShieldCheck />
        <h2>Что хранится и что уходит в AI</h2>
        <p>
          Сохраняются названия PR, задач и страниц, короткие фрагменты, тексты
          замечаний и записи времени — без кода и diff. В AI отправляется только
          текст замечания и список критериев, без имён, логинов и ссылок. Для
          реальных данных банка нужен отдельный согласованный контур; в демо
          используйте тестовые репозитории и пространства.
        </p>
      </section>
    </>
  );
}

function ConnectionsPanel({ refresh }: { refresh: () => void }) {
  const q = useQuery({
    queryKey: ["connections"],
    queryFn: () => api<{ connections: Connection[] }>("/hr/connections"),
  });
  const [source, setSource] = useState<Connection["source"]>("github"),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState("");
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    setBusy("add");
    setMessage("");
    try {
      const created = await post<Connection>("/hr/connections", {
        source,
        scope: value("scope"),
        site_url: source === "github" ? "" : value("site_url"),
        email: source === "github" ? "" : value("email"),
        token: value("token"),
      });
      form.reset();
      setMessage(
        `Подключено: ${created.name}. Теперь нажмите «Синхронизировать».`,
      );
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  async function sync(c: Connection) {
    setBusy(c.connection_id);
    setMessage("");
    try {
      const r = await post<NonNullable<Connection["last_sync"]>>(
        `/hr/connections/${c.connection_id}/sync`,
      );
      setMessage(
        `${c.name}: материалов ${r.artifacts}, задач ${r.tasks}, замечаний ${r.findings} за ${r.seconds} с.`,
      );
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(null);
      refresh();
    }
  }
  async function remove(c: Connection) {
    setBusy(c.connection_id);
    try {
      await api(`/hr/connections/${c.connection_id}`, { method: "DELETE" });
      setMessage(
        `${c.name} отключено. Токен удалён, загруженные материалы сохранены.`,
      );
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Подключения</h2>
        <span className="badge">{q.data?.connections.length ?? 0}</span>
      </div>
      {q.isError && <p className="error">{errorText(q.error)}</p>}
      {q.data?.connections.map((c) => (
        <div className="history-row" key={c.connection_id}>
          <span className="history-icon">
            <Link2 size={18} />
          </span>
          <div>
            <strong>
              {names[c.source]} · {c.name}
            </strong>
            <small>
              {c.site_url ? `${c.site_url} · ` : ""}
              {c.has_token ? `токен ${c.token_hint || "задан"}` : "без токена"}
              {" · "}
              {c.last_sync
                ? c.last_sync.ok
                  ? `синхронизировано ${time(c.last_sync.at)}: материалов ${c.last_sync.artifacts}, задач ${c.last_sync.tasks}, замечаний ${c.last_sync.findings}`
                  : `ошибка ${time(c.last_sync.at)}: ${c.last_sync.error}`
                : "ещё не синхронизировано"}
            </small>
          </div>
          <div className="button-group">
            <button
              className="secondary"
              disabled={busy !== null}
              onClick={() => sync(c)}
            >
              <RefreshCw size={15} />
              {busy === c.connection_id ? "Загружаем…" : "Синхронизировать"}
            </button>
            <button
              className="icon-button"
              aria-label={`Отключить ${c.name}`}
              title="Отключить и удалить токен"
              disabled={busy !== null}
              onClick={() => remove(c)}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
      ))}
      {q.data && !q.data.connections.length && (
        <p className="muted">Пока ничего не подключено.</p>
      )}
      <form className="connection-form" onSubmit={add}>
        <label>
          Система
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Connection["source"])}
          >
            <option value="github">GitHub</option>
            <option value="jira">Jira Cloud</option>
            <option value="confluence">Confluence Cloud</option>
          </select>
        </label>
        <label>
          {source === "github"
            ? "Репозиторий"
            : source === "jira"
              ? "Проект"
              : "Пространство"}
          <input name="scope" placeholder={scopeHint[source]} required />
        </label>
        {source !== "github" && (
          <>
            <label>
              Сайт Atlassian
              <input
                name="site_url"
                placeholder="https://company.atlassian.net"
                required
              />
            </label>
            <label>
              Email аккаунта
              <input name="email" type="email" required />
            </label>
          </>
        )}
        <label>
          {source === "github"
            ? "Токен (read-only, необязательно для публичного)"
            : "API-токен Atlassian"}
          <input
            name="token"
            type="password"
            autoComplete="off"
            required={source !== "github"}
          />
        </label>
        <button className="primary" disabled={busy !== null}>
          {busy === "add" ? "Проверяем доступ…" : "Подключить"}
        </button>
      </form>
      <p className="footnote">
        GitHub: fine-grained token с правом Pull requests: Read на выбранный
        репозиторий. Atlassian: API-токен пользователя с доступом только к
        тестовому проекту. Без токена GitHub даёт 60 запросов в час, поэтому
        загружаются последние 12 PR. Локальное демо хранит токен в своей базе;
        для production нужен секрет-менеджер.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function IdentitiesPanel({ refresh }: { refresh: () => void }) {
  const q = useQuery({
    queryKey: ["identities"],
    queryFn: () => api<Identities>("/hr/identities"),
  });
  const [values, setValues] = useState<Record<string, string>>({}),
    [message, setMessage] = useState("");
  async function map(source: string, external_id: string) {
    setMessage("");
    try {
      await post("/hr/identities", {
        source,
        external_id,
        employee_id: (values[`${source}:${external_id}`] ?? "").trim(),
      });
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function unmap(source: string, external_id: string) {
    try {
      await api(`/hr/identities/${source}/${encodeURIComponent(external_id)}`, {
        method: "DELETE",
      });
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  const d = q.data;
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Привязка аккаунтов</h2>
        <span className="badge">Без привязки: {d?.unmatched.length ?? 0}</span>
      </div>
      <p className="muted">
        Материалы непривязанных аккаунтов не анализируются. Совпадение имени не
        считается привязкой. Аккаунт Atlassian один для Jira и Confluence.
      </p>
      {d?.unmatched.map((u) => {
        const key = `${u.source}:${u.external_id}`;
        return (
          <div className="history-row" key={key}>
            <span className="history-icon">?</span>
            <div>
              <strong>
                {names[u.source]} · {u.display_name || u.external_id}
              </strong>
              <small>
                {u.external_id} · материалов и задач: {u.items}
              </small>
            </div>
            <div className="inline-form">
              <input
                aria-label={`ID сотрудника для ${u.external_id}`}
                placeholder="ID сотрудника, напр. E0002"
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              />
              <button
                className="secondary"
                disabled={!(values[key] ?? "").trim()}
                onClick={() => map(u.source, u.external_id)}
              >
                Привязать
              </button>
            </div>
          </div>
        );
      })}
      {d?.mapped.length ? (
        <details className="evidence-block">
          <summary>Привязано: {d.mapped.length}</summary>
          {d.mapped.map((m) => (
            <p className="muted" key={`${m.source}:${m.external_id}`}>
              {names[m.source]} · {m.display_name || m.external_id} →{" "}
              {m.full_name} ({m.employee_id}){" "}
              <button
                className="text-button"
                onClick={() => unmap(m.source, m.external_id)}
              >
                отвязать
              </button>
            </p>
          ))}
        </details>
      ) : null}
      {message && <p className="error">{message}</p>}
    </section>
  );
}

function FindingsPanel({ refresh }: { refresh: () => void }) {
  const q = useQuery({
    queryKey: ["findings"],
    queryFn: () =>
      api<{ pending: Pending[]; criteria: Criterion[] }>("/hr/findings"),
  });
  const [choice, setChoice] = useState<Record<string, string>>({}),
    [outcome, setOutcome] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function suggest() {
    setBusy(true);
    setMessage("");
    try {
      const r = await post<{ message: string; suggested: number }>(
        "/hr/findings/suggest",
      );
      setMessage(`${r.message}. Подсказок: ${r.suggested}.`);
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function label(p: Pending, criterion: string | null) {
    setMessage("");
    try {
      await post("/hr/findings/label", {
        artifact_id: p.artifact_id,
        finding_id: p.finding_id,
        criterion_id: criterion,
        outcome: outcome[p.finding_id] ?? "open",
      });
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  const d = q.data;
  const title = (id: string | null) =>
    d?.criteria.find((c) => c.criterion_id === id)?.title;
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Разметка замечаний ревью</h2>
        <button
          className="secondary"
          disabled={busy || !d?.pending.length}
          onClick={suggest}
        >
          <Sparkles size={15} />
          {busy ? "AI размечает…" : "Предложить критерии с AI"}
        </button>
      </div>
      <p className="muted">
        AI только предлагает критерий. В анализ идут замечания, которые вы
        подтвердили. «Не относится» — стиль, опечатки, вопросы.
      </p>
      {message && <p role="status">{message}</p>}
      {d?.pending.map((p) => {
        const suggested =
          p.suggested_criterion && p.suggested_criterion !== "none"
            ? p.suggested_criterion
            : "";
        const selected = choice[p.finding_id] ?? suggested;
        return (
          <article className="observation" key={p.finding_id}>
            <header>
              <span className="badge">
                {names[p.source]} ·{" "}
                {p.full_name ?? `${p.author} — аккаунт не привязан`}
              </span>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {p.artifact_title}
              </a>
            </header>
            <p>
              <strong>{p.reviewer}:</strong> «{p.text}»
            </p>
            {p.suggested_criterion && (
              <p className="muted">
                <Sparkles size={13} /> AI:{" "}
                {p.suggested_criterion === "none"
                  ? "не относится к навыкам"
                  : title(p.suggested_criterion)}
                {p.suggestion_reason ? ` — ${p.suggestion_reason}` : ""}
              </p>
            )}
            <div className="inline-form">
              <select
                aria-label="Критерий"
                value={selected}
                onChange={(e) =>
                  setChoice({ ...choice, [p.finding_id]: e.target.value })
                }
              >
                <option value="">— выберите критерий —</option>
                {d.criteria.map((c) => (
                  <option key={c.criterion_id} value={c.criterion_id}>
                    {c.roles.join(", ")}: {c.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Статус замечания"
                value={outcome[p.finding_id] ?? "open"}
                onChange={(e) =>
                  setOutcome({ ...outcome, [p.finding_id]: e.target.value })
                }
              >
                <option value="open">Не исправлено</option>
                <option value="fixed">Исправлено после ревью</option>
              </select>
              <button
                className="primary"
                disabled={!selected}
                onClick={() => label(p, selected)}
              >
                Подтвердить
              </button>
              <button className="secondary" onClick={() => label(p, null)}>
                Не относится
              </button>
            </div>
          </article>
        );
      })}
      {d && !d.pending.length && (
        <p className="muted">Нет замечаний, ожидающих разметки.</p>
      )}
    </section>
  );
}
