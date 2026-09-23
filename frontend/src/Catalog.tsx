import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles } from "lucide-react";
import { api, post } from "./api";
import type { Catalog, CourseRecord, CourseDraftData, Quest } from "./types";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";
const GRADES = ["Junior", "Middle", "Senior", "Lead"];
const statusText: Record<CourseRecord["status"], string> = {
  draft: "Черновик",
  in_review: "На проверке",
  changes_requested: "Нужны правки",
  approved: "Одобрен",
  published: "Опубликован",
  archived: "Снят",
};
const actionText: Record<string, string> = {
  created: "создан",
  edited: "изменён",
  submitted: "отправлен на проверку",
  approved: "одобрен",
  changes_requested: "возвращён на доработку",
  published: "опубликован",
  new_version: "новая версия",
  archived: "снят с каталога",
};

const emptyDraft = (catalog: Catalog): CourseDraftData => ({
  title: "",
  description: "",
  type: "course",
  format: "self_paced",
  duration_hours: 4,
  target_roles: [catalog.profiles[0].role],
  target_grades: ["Middle"],
  develops_skills: [
    { skill_id: catalog.skills[0].skill_id, gain: 1, max_level: 3 },
  ],
  prerequisites: {},
  upcoming_sessions: [],
  quiz: null,
});

export function CatalogPage({
  catalog,
  username,
}: {
  catalog: Catalog;
  username: string;
}) {
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ["courses"],
    queryFn: () => api<CourseRecord[]>("/hr/courses"),
  });
  const [editing, setEditing] = useState<CourseRecord | "new" | null>(null),
    [message, setMessage] = useState(""),
    [notes, setNotes] = useState<Record<string, string>>({});
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["courses"] });
    void cache.invalidateQueries({ queryKey: ["catalog"] });
    void cache.invalidateQueries({ queryKey: ["profile"] });
  };
  async function act(c: CourseRecord, action: string, body?: unknown) {
    setMessage("");
    try {
      await post(`/hr/courses/${c.course_id}/${action}`, body);
      refresh();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  if (q.isPending) return <div className="loading">Загружаем каталог…</div>;
  if (q.isError) return <p className="error">{errorText(q.error)}</p>;
  if (editing)
    return (
      <CourseEditor
        catalog={catalog}
        course={editing === "new" ? null : editing}
        close={() => setEditing(null)}
        saved={() => {
          refresh();
          setEditing(null);
        }}
      />
    );
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">КАТАЛОГ ОБУЧЕНИЯ</span>
          <h1>Курсы и тесты</h1>
          <p>
            Черновик → проверка другим HR-экспертом → явная публикация. AI
            только предлагает текст и вопросы, публикует человек.
          </p>
        </div>
        <button className="primary" onClick={() => setEditing("new")}>
          <Plus size={16} /> Новый курс
        </button>
      </div>
      {message && <p className="error">{message}</p>}
      {!q.data.length && (
        <div className="empty">
          Своих курсов пока нет. Базовый каталог организаторов уже доступен в
          рекомендациях.
        </div>
      )}
      {q.data.map((c) => {
        const mine = c.author === username;
        return (
          <section className="panel course-card" key={c.course_id}>
            <div className="panel-title">
              <div>
                <h2>{c.draft.title}</h2>
                <p className="muted">
                  Версия {c.version}
                  {c.event_id ? ` · ${c.event_id}` : ""} · автор {c.author}
                  {c.reviewer ? ` · проверил ${c.reviewer}` : ""}
                  {c.ai_assisted ? " · с AI-черновиком" : ""}
                </p>
              </div>
              <span className={`status course-${c.status}`}>
                {statusText[c.status]}
              </span>
            </div>
            <p>{c.draft.description}</p>
            <p className="muted">
              {c.draft.target_roles.join(", ")} ·{" "}
              {c.draft.target_grades.join(", ")} · {c.draft.duration_hours} ч ·
              навыки:{" "}
              {c.draft.develops_skills
                .map(
                  (g) =>
                    `${catalog.skills.find((s) => s.skill_id === g.skill_id)?.name ?? g.skill_id} +${g.gain} (до ${g.max_level})`,
                )
                .join(", ")}{" "}
              · тест:{" "}
              {c.draft.quiz ? `${c.draft.quiz.questions.length} вопр.` : "нет"}
            </p>
            <div className="button-group">
              {["draft", "changes_requested"].includes(c.status) && (
                <button className="secondary" onClick={() => setEditing(c)}>
                  Редактировать
                </button>
              )}
              {c.status === "draft" && (
                <button className="primary" onClick={() => act(c, "submit")}>
                  Отправить на проверку
                </button>
              )}
              {c.status === "in_review" &&
                (mine ? (
                  <span className="muted">
                    Ждёт проверки другим HR-экспертом (например, expert).
                  </span>
                ) : (
                  <>
                    <input
                      aria-label="Комментарий проверки"
                      placeholder="Комментарий эксперта"
                      value={notes[c.course_id] ?? ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [c.course_id]: e.target.value })
                      }
                    />
                    <button
                      className="primary"
                      disabled={(notes[c.course_id] ?? "").length < 3}
                      onClick={() =>
                        act(c, "review", {
                          decision: "approved",
                          note: notes[c.course_id],
                        })
                      }
                    >
                      Одобрить
                    </button>
                    <button
                      className="secondary"
                      disabled={(notes[c.course_id] ?? "").length < 3}
                      onClick={() =>
                        act(c, "review", {
                          decision: "changes_requested",
                          note: notes[c.course_id],
                        })
                      }
                    >
                      Вернуть на доработку
                    </button>
                  </>
                ))}
              {c.status === "approved" && (
                <button className="primary" onClick={() => act(c, "publish")}>
                  Опубликовать в каталог
                </button>
              )}
              {["published", "archived"].includes(c.status) && (
                <button
                  className="secondary"
                  onClick={() => act(c, "new-version")}
                >
                  Новая версия
                </button>
              )}
              {c.status === "published" && (
                <button className="secondary" onClick={() => act(c, "archive")}>
                  Снять с каталога
                </button>
              )}
            </div>
            <details className="assessment-details">
              <summary>Журнал изменений</summary>
              {c.history.map((h, i) => (
                <p key={i}>
                  {new Date(h.at).toLocaleString("ru-RU")} · {h.actor} ·{" "}
                  {actionText[h.action] ?? h.action}
                  {h.note ? ` — ${h.note}` : ""}
                </p>
              ))}
            </details>
          </section>
        );
      })}
    </>
  );
}

function CourseEditor({
  catalog,
  course,
  close,
  saved,
}: {
  catalog: Catalog;
  course: CourseRecord | null;
  close: () => void;
  saved: () => void;
}) {
  const [d, setD] = useState<CourseDraftData>(
      course?.draft ?? emptyDraft(catalog),
    ),
    [sessions, setSessions] = useState(
      (course?.draft.upcoming_sessions ?? []).join(", "),
    ),
    [aiUsed, setAIUsed] = useState(false),
    [aiBusy, setAIBusy] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const roles = [...new Set(catalog.profiles.map((p) => p.role))];
  const set = <K extends keyof CourseDraftData>(k: K, v: CourseDraftData[K]) =>
    setD({ ...d, [k]: v });
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      ...d,
      upcoming_sessions:
        d.format === "self_paced"
          ? []
          : sessions
              .split(/[\s,;]+/)
              .map((s) => s.trim())
              .filter(Boolean),
      revision: course?.revision ?? 0,
    };
    try {
      if (course)
        await api(
          `/hr/courses/${course.course_id}${aiUsed ? "?ai_assisted=true" : ""}`,
          { method: "PUT", body: JSON.stringify(body) },
        );
      else await post("/hr/courses", body);
      saved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function suggest() {
    if (!course) return;
    setAIBusy(true);
    setError("");
    try {
      const r = await post<{
        mode: string;
        message?: string;
        suggestion?: {
          description: string;
          questions: {
            question: string;
            options: string[];
            correct: number;
            skill_id: string;
          }[];
        };
      }>(`/hr/courses/${course.course_id}/ai-draft`);
      if (r.suggestion) {
        setD({
          ...d,
          description: r.suggestion.description,
          quiz: {
            pass_score: d.quiz?.pass_score ?? 70,
            questions: r.suggestion.questions,
          },
        });
        setAIUsed(true);
      } else setError(r.message ?? "AI недоступен");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setAIBusy(false);
    }
  }
  const quiz = d.quiz;
  return (
    <section className="panel course-editor">
      <div className="panel-title">
        <h2>{course ? `Черновик · версия ${course.version}` : "Новый курс"}</h2>
        <div className="button-group">
          {course && (
            <button
              type="button"
              className="secondary"
              onClick={suggest}
              disabled={aiBusy}
            >
              <Sparkles size={16} />
              {aiBusy ? "AI готовит…" : "AI-черновик описания и теста"}
            </button>
          )}
          <button type="button" className="secondary" onClick={close}>
            Отмена
          </button>
        </div>
      </div>
      {aiUsed && (
        <p className="callout">
          Описание и вопросы предложены AI. Проверьте факты и правильные ответы
          перед сохранением — после этого курс ещё пройдёт проверку экспертом.
        </p>
      )}
      <form onSubmit={save} className="course-form">
        <label>
          Название
          <input
            value={d.title}
            onChange={(e) => set("title", e.target.value)}
            minLength={3}
            maxLength={120}
            required
          />
        </label>
        <label>
          Описание: чему научится участник
          <textarea
            value={d.description}
            onChange={(e) => set("description", e.target.value)}
            minLength={10}
            maxLength={1500}
            required
          />
        </label>
        <div className="form-row">
          <label>
            Тип
            <select
              value={d.type}
              onChange={(e) =>
                set("type", e.target.value as CourseDraftData["type"])
              }
            >
              <option value="course">Курс</option>
              <option value="workshop">Воркшоп</option>
              <option value="mentoring">Менторство</option>
              <option value="certification">Сертификация</option>
              <option value="meetup">Встреча</option>
            </select>
          </label>
          <label>
            Формат
            <select
              value={d.format}
              onChange={(e) =>
                set("format", e.target.value as CourseDraftData["format"])
              }
            >
              <option value="self_paced">В своём темпе</option>
              <option value="online">Онлайн</option>
              <option value="offline">Очно</option>
            </select>
          </label>
          <label>
            Часов
            <input
              type="number"
              min={1}
              max={200}
              value={d.duration_hours}
              onChange={(e) => set("duration_hours", Number(e.target.value))}
            />
          </label>
        </div>
        {d.format !== "self_paced" && (
          <label>
            Даты сессий (ГГГГ-ММ-ДД, через запятую)
            <input
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
              placeholder="2026-11-10, 2026-12-08"
            />
          </label>
        )}
        <fieldset>
          <legend>Для кого</legend>
          <div className="check-grid">
            {roles.map((r) => (
              <label className="check" key={r}>
                <input
                  type="checkbox"
                  checked={d.target_roles.includes(r)}
                  onChange={() =>
                    set("target_roles", toggle(d.target_roles, r))
                  }
                />
                {r}
              </label>
            ))}
          </div>
          <div className="check-grid">
            {GRADES.map((g) => (
              <label className="check" key={g}>
                <input
                  type="checkbox"
                  checked={d.target_grades.includes(g)}
                  onChange={() =>
                    set("target_grades", toggle(d.target_grades, g))
                  }
                />
                {g}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Какие навыки развивает</legend>
          {d.develops_skills.map((g, i) => (
            <div className="form-row" key={i}>
              <select
                aria-label="Навык"
                value={g.skill_id}
                onChange={(e) =>
                  set(
                    "develops_skills",
                    d.develops_skills.map((x, j) =>
                      j === i ? { ...x, skill_id: e.target.value } : x,
                    ),
                  )
                }
              >
                {catalog.skills.map((s) => (
                  <option key={s.skill_id} value={s.skill_id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <label>
                Прирост
                <select
                  value={g.gain}
                  onChange={(e) =>
                    set(
                      "develops_skills",
                      d.develops_skills.map((x, j) =>
                        j === i ? { ...x, gain: Number(e.target.value) } : x,
                      ),
                    )
                  }
                >
                  <option value={1}>+1</option>
                  <option value={2}>+2</option>
                </select>
              </label>
              <label>
                Не выше уровня
                <select
                  value={g.max_level}
                  onChange={(e) =>
                    set(
                      "develops_skills",
                      d.develops_skills.map((x, j) =>
                        j === i
                          ? { ...x, max_level: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              {d.develops_skills.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    set(
                      "develops_skills",
                      d.develops_skills.filter((_, j) => j !== i),
                    )
                  }
                >
                  Убрать
                </button>
              )}
            </div>
          ))}
          {d.develops_skills.length < 5 && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                set("develops_skills", [
                  ...d.develops_skills,
                  {
                    skill_id: catalog.skills[0].skill_id,
                    gain: 1,
                    max_level: 3,
                  },
                ])
              }
            >
              + Навык
            </button>
          )}
        </fieldset>
        <fieldset>
          <legend>Тест после курса</legend>
          {!quiz ? (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                set("quiz", {
                  pass_score: 70,
                  questions: [
                    {
                      question: "",
                      options: ["", ""],
                      correct: 0,
                      skill_id: null,
                    },
                  ],
                })
              }
            >
              Добавить тест
            </button>
          ) : (
            <>
              <label>
                Проходной балл, %
                <input
                  type="number"
                  min={50}
                  max={100}
                  value={quiz.pass_score}
                  onChange={(e) =>
                    set("quiz", { ...quiz, pass_score: Number(e.target.value) })
                  }
                />
              </label>
              {quiz.questions.map((qq, i) => {
                const update = (patch: Partial<typeof qq>) =>
                  set("quiz", {
                    ...quiz,
                    questions: quiz.questions.map((x, j) =>
                      j === i ? { ...x, ...patch } : x,
                    ),
                  });
                return (
                  <div className="quiz-question" key={i}>
                    <label>
                      Вопрос {i + 1}
                      <input
                        value={qq.question}
                        onChange={(e) => update({ question: e.target.value })}
                        minLength={5}
                        required
                      />
                    </label>
                    {qq.options.map((o, k) => (
                      <label className="check" key={k}>
                        <input
                          type="radio"
                          name={`correct-${i}`}
                          checked={qq.correct === k}
                          onChange={() => update({ correct: k })}
                          aria-label={`Правильный ответ ${k + 1}`}
                        />
                        <input
                          value={o}
                          onChange={(e) =>
                            update({
                              options: qq.options.map((x, m) =>
                                m === k ? e.target.value : x,
                              ),
                            })
                          }
                          placeholder={`Вариант ${k + 1}`}
                          required
                        />
                      </label>
                    ))}
                    <div className="button-group">
                      {qq.options.length < 5 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            update({ options: [...qq.options, ""] })
                          }
                        >
                          + Вариант
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          set(
                            "quiz",
                            quiz.questions.length > 1
                              ? {
                                  ...quiz,
                                  questions: quiz.questions.filter(
                                    (_, j) => j !== i,
                                  ),
                                }
                              : null,
                          )
                        }
                      >
                        Удалить вопрос
                      </button>
                    </div>
                  </div>
                );
              })}
              {quiz.questions.length < 20 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    set("quiz", {
                      ...quiz,
                      questions: [
                        ...quiz.questions,
                        {
                          question: "",
                          options: ["", ""],
                          correct: 0,
                          skill_id: null,
                        },
                      ],
                    })
                  }
                >
                  + Вопрос
                </button>
              )}
            </>
          )}
        </fieldset>
        {error && <p className="error">{error}</p>}
        <button className="primary full" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить черновик"}
        </button>
      </form>
    </section>
  );
}

type QuizData = {
  event_id: string;
  title: string;
  pass_score: number;
  questions: { question: string; options: string[] }[];
};
type QuizResult = {
  score: number;
  passed: boolean;
  pass_score: number;
  attempts_left: number;
  completion: { status: string } | null;
};

export function QuizPanel({
  eid,
  quests,
  onDone,
}: {
  eid: string;
  quests: Quest[];
  onDone: () => void;
}) {
  const withQuiz = quests.filter((q) => q.has_quiz);
  const [open, setOpen] = useState<string | null>(null);
  if (!withQuiz.length) return null;
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Тесты по курсам</h2>
        <span className="badge">После прохождения</span>
      </div>
      <p className="muted">
        Сданный тест по курсу в своём темпе отправляет заявку о завершении HR.
        Навыки меняются только после подтверждения.
      </p>
      {withQuiz.map((q) => (
        <div className="history-row" key={q.event_id}>
          <div>
            <strong>{q.title}</strong>
            <small>{q.duration_hours} ч</small>
          </div>
          <button className="secondary" onClick={() => setOpen(q.event_id)}>
            Пройти тест
          </button>
        </div>
      ))}
      {open && (
        <QuizRunner
          eid={eid}
          eventId={open}
          close={() => {
            setOpen(null);
            onDone();
          }}
        />
      )}
    </section>
  );
}

function QuizRunner({
  eid,
  eventId,
  close,
}: {
  eid: string;
  eventId: string;
  close: () => void;
}) {
  const q = useQuery({
    queryKey: ["quiz", eventId],
    queryFn: () => api<QuizData>(`/courses/${eventId}/quiz`),
  });
  const [answers, setAnswers] = useState<Record<number, number>>({}),
    [result, setResult] = useState<QuizResult | null>(null),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.data) return;
    setError("");
    try {
      setResult(
        await post<QuizResult>(`/employees/${eid}/quiz/${eventId}`, {
          answers: q.data.questions.map((_, i) => answers[i]),
        }),
      );
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div className="overlay" onClick={close}>
      <section
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Тест"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{q.data?.title ?? "Тест"}</h2>
          <button className="icon-button" aria-label="Закрыть" onClick={close}>
            ×
          </button>
        </header>
        {q.isError && <p className="error">{errorText(q.error)}</p>}
        {result ? (
          <div className="callout">
            <strong>
              {result.passed ? "Тест сдан" : "Пока не сдан"}: {result.score}%
            </strong>{" "}
            (порог {result.pass_score}%).{" "}
            {result.passed
              ? result.completion
                ? "Заявка о завершении отправлена HR."
                : "Результат сохранён; завершение очного курса подтверждается после сессии."
              : `Осталось попыток: ${result.attempts_left}.`}
          </div>
        ) : (
          q.data && (
            <form onSubmit={submit}>
              <p>Проходной балл: {q.data.pass_score}%.</p>
              {q.data.questions.map((qq, i) => (
                <fieldset key={i}>
                  <legend>
                    {i + 1}. {qq.question}
                  </legend>
                  {qq.options.map((o, k) => (
                    <label className="check" key={k}>
                      <input
                        type="radio"
                        name={`q-${i}`}
                        checked={answers[i] === k}
                        onChange={() => setAnswers({ ...answers, [i]: k })}
                        required
                      />
                      {o}
                    </label>
                  ))}
                </fieldset>
              ))}
              {error && <p className="error">{error}</p>}
              <button className="primary full">Отправить ответы</button>
            </form>
          )
        )}
      </section>
    </div>
  );
}
