import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, Sparkles } from "lucide-react";
import { api } from "./api";
import type { Quest } from "./types";

type AIReply = {
  mode: "ai" | "rules";
  explanations: Record<string, string>;
  message?: string;
  cached?: boolean;
};

export function AIRecommendations({
  eid,
  quests,
  available,
  onComplete,
}: {
  eid: string;
  quests: Quest[];
  available: boolean;
  onComplete?: (quest: Quest) => void;
}) {
  const [reply, setReply] = useState<AIReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (reply || error) result.current?.focus({ preventScroll: true });
  }, [reply, error]);

  async function explain() {
    if (busy) return;
    if (reply?.mode === "ai") {
      result.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      result.current?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    setError("");
    setReply(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const data = await api<AIReply>(`/employees/${eid}/ai-explanation`, {
        method: "POST",
        body: "{}",
        signal: controller.signal,
      });
      if (data.mode === "ai") {
        const ids = new Set(quests.map((q) => q.event_id));
        const entries = Object.entries(data.explanations ?? {});
        if (
          entries.length !== ids.size ||
          entries.some(
            ([id, text]) =>
              !ids.has(id) || typeof text !== "string" || !text.trim(),
          )
        ) {
          throw new Error(
            "AI вернул неполный ответ. Подбор по правилам сохранён.",
          );
        }
      }
      if (!controller.signal.aborted) setReply(data);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Не удалось получить объяснение. Попробуйте ещё раз.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ОТ ЦЕЛИ К ДЕЙСТВИЮ</span>
          <h2>Рекомендовано для вашего роста</h2>
          <p>Не просто курс — конкретный шаг к выбранной роли.</p>
        </div>
        <button
          className="secondary"
          onClick={explain}
          disabled={busy || !quests.length}
        >
          <Sparkles size={16} />
          {busy
            ? "AI объясняет…"
            : reply?.mode === "ai"
              ? "Показать объяснения"
              : available
                ? "Объяснить с AI"
                : "Проверить AI-подключение"}
        </button>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {busy ? (
          <div className="ai-result loading-result" role="status">
            <Sparkles size={22} />
            <div>
              <strong>Готовим объяснения для {quests.length} курсов</strong>
              <p>
                Рекомендации уже рассчитаны. AI объяснит их пользу для вашей
                цели.
              </p>
            </div>
          </div>
        ) : reply || error ? (
          <div
            ref={result}
            tabIndex={-1}
            className={`ai-result ${reply?.mode === "ai" && !error ? "success" : "warning"}`}
            role={error ? "alert" : "status"}
          >
            {reply?.mode === "ai" && !error ? (
              <Check size={24} />
            ) : (
              <Sparkles size={24} />
            )}
            <div>
              <strong>
                {error
                  ? "AI-объяснение не получено"
                  : reply?.mode === "ai"
                    ? `Готово — объяснения добавлены к ${quests.length} курсам`
                    : "Сейчас используется подбор по правилам"}
              </strong>
              <p>
                {error ||
                  (reply?.mode === "ai"
                    ? "Ниже в каждой карточке появился отдельный блок «Почему AI рекомендует этот курс». Проверьте факты перед выбором."
                    : reply?.message ||
                      "AI недоступен. Курсы и расчёт прогресса остаются доступны.")}
              </p>
              {reply?.mode === "ai" && (
                <small>
                  {reply.cached
                    ? "Показан сохранённый ответ — без повторного обращения к модели."
                    : "Получен новый ответ AI. Повторное открытие не требует нового запроса."}
                </small>
              )}
            </div>
          </div>
        ) : (
          <div className="mode-note">
            <span className="tiny-dot" />
            Подбор по правилам · нажмите «Объяснить с AI», чтобы увидеть
            отдельные объяснения
          </div>
        )}
      </div>
      <div className="quest-grid">
        {quests.map((q, index) => (
          <article className="quest-card" key={q.event_id}>
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
              <span>
                {{
                  online: "Онлайн",
                  offline: "Очно",
                  self_paced: "В своём темпе",
                }[q.format] ?? q.format}
              </span>
            </div>
            <p>{q.reason}</p>
            {reply?.mode === "ai" && reply.explanations[q.event_id] && (
              <section
                className="ai-course-explanation"
                aria-label={`AI-объяснение: ${q.title}`}
              >
                <h4>
                  <Sparkles size={16} />
                  Почему AI рекомендует этот курс
                </h4>
                <p>{reply.explanations[q.event_id]}</p>
              </section>
            )}
            <div className="benefits">
              {q.benefits.slice(0, 3).map((b) => (
                <span
                  key={b.name}
                  title={
                    b.evidence
                      ? "Зона развития подтверждена экспертом по рабочим примерам"
                      : undefined
                  }
                >
                  {b.name}
                  {b.evidence && " ✓"}
                  <strong>
                    {b.from} → {b.to}
                  </strong>
                </span>
              ))}
            </div>
            {q.past_misses > 0 && (
              <small className="history-hint">
                За 180 дней: {q.past_misses} пропусков/отказов от этого
                мероприятия. Стоит обсудить подходящий формат.
              </small>
            )}
            {!!q.similar_misses && (
              <small className="history-hint">
                Есть {q.similar_misses} пропуска/отказа от других мероприятий по
                тем же навыкам. Это контекст выбора, не оценка мотивации.
              </small>
            )}
            <footer>
              <small>
                {q.next_session
                  ? `Ближайшая сессия: ${new Date(q.next_session + "T12:00:00").toLocaleDateString("ru-RU")}`
                  : "Можно учиться в своём темпе"}
              </small>
              {onComplete && (
                <button
                  className="card-button"
                  onClick={() => onComplete(q)}
                  disabled={q.format !== "self_paced"}
                >
                  {q.format === "self_paced"
                    ? "Сообщить о завершении"
                    : "Завершение после сессии"}
                  <ArrowRight size={16} />
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
    </>
  );
}
