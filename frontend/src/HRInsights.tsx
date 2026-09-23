import { useState } from "react";
import { Sparkles } from "lucide-react";
import { post } from "./api";
import type { Activity, Overview, Quest } from "./types";

const formats: Record<string, string> = {
  online: "Онлайн",
  offline: "Очно",
  self_paced: "В своём темпе",
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";

type SortKey = "participants" | "completion_rate" | "no_show" | "dropped";

export function ActivitiesPanel({ activities }: { activities: Activity[] }) {
  const [sort, setSort] = useState<SortKey>("participants"),
    [kind, setKind] = useState<"all" | "voluntary" | "mandatory">("voluntary"),
    [all, setAll] = useState(false);
  const rows = activities
    .filter(
      (a) =>
        kind === "all" || (kind === "mandatory" ? a.mandatory : !a.mandatory),
    )
    .sort((a, b) =>
      sort === "completion_rate"
        ? (a.completion_rate ?? 101) - (b.completion_rate ?? 101)
        : b[sort] - a[sort],
    );
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <section className="panel table-panel">
      <div className="panel-title">
        <div>
          <h2>Участие по активностям</h2>
          <p className="muted">
            Кто и чем заканчивает обучение в выбранной команде. Завершение —
            доля завершённых среди закончившихся записей; просрочки и неявки
            считаются незавершёнными.
          </p>
        </div>
        <div className="table-filters">
          <select
            aria-label="Тип мероприятий"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="voluntary">Добровольные</option>
            <option value="mandatory">Обязательные</option>
            <option value="all">Все</option>
          </select>
          <select
            aria-label="Сортировка"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="participants">Больше участников</option>
            <option value="completion_rate">Ниже завершение</option>
            <option value="no_show">Больше неявок</option>
            <option value="dropped">Чаще бросают</option>
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table className="activity-table">
          <thead>
            <tr>
              <th>Мероприятие</th>
              <th>Участников</th>
              <th>Завершили</th>
              <th>Неявки</th>
              <th>Прервали</th>
              <th>Отказы</th>
              <th>Сейчас / просрочено</th>
              <th>Завершение</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.event_id}>
                <td>
                  <strong>{a.title}</strong>
                  <small>
                    {a.mandatory ? "Обязательное · " : ""}
                    {a.type} · {formats[a.format] ?? a.format}
                  </small>
                </td>
                <td>{a.participants}</td>
                <td>{a.completed}</td>
                <td>{a.no_show}</td>
                <td>{a.dropped}</td>
                <td>{a.declined}</td>
                <td>
                  {a.in_progress} / {a.overdue}
                </td>
                <td>
                  <span
                    className={`rate ${a.completion_rate !== null && a.completion_rate < 60 ? "low" : ""}`}
                  >
                    {a.completion_rate === null ? "—" : `${a.completion_rate}%`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="empty">Записей об участии в этой выборке нет.</div>
      )}
      {rows.length > 8 && (
        <button className="text-button" onClick={() => setAll(!all)}>
          {all ? "Свернуть" : `Показать все (${rows.length})`}
        </button>
      )}
    </section>
  );
}

export function NoStepPanel({
  data,
  onFilter,
}: {
  data: Overview;
  onFilter: () => void;
}) {
  return (
    <section className="panel">
      <h2>Нет рекомендованного шага</h2>
      <p className="muted">
        У {data.no_step} из {data.total} сотрудников система не нашла доступного
        обучения. Причина видна в строке сотрудника.
      </p>
      {data.no_step_reasons.map((r) => (
        <div className="aggregate" key={r.code}>
          <span>{r.text}</span>
          <div>
            <i
              style={{
                width: `${data.no_step ? (r.count / data.no_step) * 100 : 0}%`,
              }}
            />
          </div>
          <strong>{r.count}</strong>
        </div>
      ))}
      {!!data.no_step && (
        <button className="text-button" onClick={onFilter}>
          Показать сотрудников →
        </button>
      )}
    </section>
  );
}

type Briefing = {
  summary: string;
  talking_points: string[];
  next_step: string;
  event_id: string | null;
};

export function AIBriefing({
  eid,
  quests,
  available,
}: {
  eid: string;
  quests: Quest[];
  available: boolean;
}) {
  const [reply, setReply] = useState<{
      mode: "ai" | "rules";
      briefing?: Briefing;
      message?: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    try {
      setReply(await post(`/team/employees/${eid}/ai-briefing`));
    } catch (e) {
      setReply({ mode: "rules", message: errorText(e) });
    } finally {
      setBusy(false);
    }
  }
  const b = reply?.briefing;
  const event = b?.event_id
    ? quests.find((q) => q.event_id === b.event_id)
    : undefined;
  return (
    <section className="panel ai-briefing" aria-live="polite">
      <div className="panel-title">
        <div>
          <span className="eyebrow">AI-РАЗБОР ДЛЯ РАЗГОВОРА</span>
          <h2>Как начать разговор о развитии</h2>
        </div>
        <button className="secondary" onClick={ask} disabled={busy}>
          <Sparkles size={16} />
          {busy
            ? "AI готовит разбор…"
            : b
              ? "Обновить"
              : available
                ? "Подготовить с AI"
                : "Проверить AI"}
        </button>
      </div>
      {!reply && (
        <p className="muted">
          Модель получает только проверенные факты: роль, разрывы, сигналы
          поддержки, статус плана и рекомендации. Без имени, ID и текстов
          заметок.
        </p>
      )}
      {reply && !b && <p className="callout">{reply.message}</p>}
      {b && (
        <div className="briefing-body">
          <p>{b.summary}</p>
          <strong>О чём спросить</strong>
          <ul>
            {b.talking_points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="callout">
            <strong>Шаг на 2 недели.</strong> {b.next_step}
            {event && (
              <small>
                Мероприятие из каталога: {event.title} · {event.duration_hours}{" "}
                ч
              </small>
            )}
          </div>
          <small className="muted">
            Черновик AI для подготовки. Проверьте факты — решение принимает
            человек.
          </small>
        </div>
      )}
    </section>
  );
}
