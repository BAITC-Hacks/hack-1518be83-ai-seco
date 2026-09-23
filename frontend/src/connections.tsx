import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Integrations, Source } from "./types";
import { Empty, Modal, dateText, errorText, sourceNames, useToast } from "./ui";

const about: Record<Source, string> = {
  github: "Репозитории, pull requests и замечания к коду.",
  jira: "Задачи, критерии готовности и обсуждения работы.",
};

export function Connections({ eid }: { eid: string }) {
  const cache = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["integrations", eid],
    queryFn: () => api<Integrations>(`/employees/${eid}/integrations`),
  });
  const [draft, setDraft] = useState<Source | null>(null),
    [busy, setBusy] = useState(false);
  async function change(
    source: Source,
    resources: string[] | null,
    message: string,
  ) {
    setBusy(true);
    try {
      const data = await api<Integrations>(
        `/employees/${eid}/integrations/${source}`,
        {
          method: resources ? "PUT" : "DELETE",
          body: resources
            ? JSON.stringify({ resources, consent: true })
            : undefined,
        },
      );
      cache.setQueryData(["integrations", eid], data);
      void cache.invalidateQueries({ queryKey: ["team"] });
      toast(message);
      setDraft(null);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending)
    return <div className="loading">Загружаем подключения…</div>;
  if (query.isError) return <p className="error">{errorText(query.error)}</p>;
  const d = query.data;
  return (
    <>
      <div className="section-head">
        <div>
          <p className="section-kicker">МОИ ПОДКЛЮЧЕНИЯ · ДЕМО</p>
          <h2>Мои рабочие инструменты</h2>
          <p className="section-caption no-margin">
            Вы управляете только своими подключениями. HR видит выжимку лишь по
            тем источникам, которые вы разрешили.
          </p>
        </div>
      </div>
      <div className="demo-notice">
        <b>Демонстрационные подключения</b>
        <p>
          Вместо авторизации загружаются синтетические PR, задачи и замечания за{" "}
          {d.period}. Пароли и токены не нужны, запросов в GitHub и Jira нет.
        </p>
      </div>
      <div className="integration-grid">
        {(["github", "jira"] as Source[]).map((source) => {
          const s = d.sources[source];
          return (
            <article className="panel integration-card" key={source}>
              <div className="panel-head">
                <div className="provider-title">
                  <span className={`provider-icon ${source}`}>
                    {source === "github" ? "GH" : "J"}
                  </span>
                  <h3>{sourceNames[source]}</h3>
                </div>
                <span
                  className={`review-status ${s.status === "connected" ? "reviewed" : ""}`}
                >
                  {s.status === "connected"
                    ? "Подключено"
                    : s.available
                      ? "Не подключено"
                      : "Нет аккаунта"}
                </span>
              </div>
              <p>{about[source]}</p>
              {!s.available ? (
                <div className="connection-detail">
                  <p>
                    У вас нет аккаунта GitHub — для вашей роли это нормально.
                    Источник не используется и никак не влияет на оценку и
                    очередь поддержки.
                  </p>
                </div>
              ) : s.status === "connected" ? (
                <>
                  <div className="connection-detail">
                    <b>Аккаунт: {s.login}</b>
                    <p>{s.resources?.join(", ")}</p>
                    {s.summary && (
                      <p>
                        {source === "github"
                          ? `${s.summary.items} PR · ${s.summary.merged} слито · ${s.summary.reviews} ревью`
                          : `${s.summary.items} задач · ${s.summary.done} закрыто · ${s.summary.story_points} SP`}
                      </p>
                    )}
                    <small>
                      Синхронизировано:{" "}
                      {s.synced_at ? dateText(s.synced_at) : "—"}
                    </small>
                  </div>
                  <div className="button-row">
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        change(
                          source,
                          s.resources ?? [],
                          "Демо-срез обновлён. Дубликаты не добавлены.",
                        )
                      }
                    >
                      Обновить
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        change(
                          source,
                          null,
                          "Источник отключён. Его примеры удалены из анализа HR.",
                        )
                      }
                    >
                      Отключить
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="connection-detail">
                    <p>
                      Доступ только на чтение. Вы сами выбираете, какие проекты
                      можно анализировать.
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => setDraft(source)}
                  >
                    Подключить {sourceNames[source]} · демо
                  </button>
                </>
              )}
            </article>
          );
        })}
      </div>
      <section className="panel block">
        <h3>Что увидит HR</h3>
        {d.signal ? (
          <div className="signal-block">
            <h4>{d.signal.title}</h4>
            <p>{d.signal.text}</p>
          </div>
        ) : (
          <Empty>Пока ничего: источники не подключены.</Empty>
        )}
        <div className="privacy-grid">
          <div>
            <b>01 · Контекст работы</b>
            <p>
              Только выбранные проекты: изменения, замечания ревью и обсуждения
              задач.
            </p>
          </div>
          <div>
            <b>02 · Проверяемые гипотезы</b>
            <p>
              Источник → навык → расхождение с целью → рекомендация. Мало данных
              — нет вывода.
            </p>
          </div>
          <div>
            <b>03 · Решение человека</b>
            <p>
              Отсутствие активности не означает отсутствие навыка. Уровни не
              меняются автоматически, рейтингов нет.
            </p>
          </div>
        </div>
      </section>
      {draft && (
        <ConnectModal
          source={draft}
          choices={d.sources[draft].choices}
          busy={busy}
          close={() => setDraft(null)}
          submit={(resources) =>
            change(
              draft,
              resources,
              "Источник подключён. Сигнал появится в сводке HR.",
            )
          }
        />
      )}
    </>
  );
}

function ConnectModal({
  source,
  choices,
  busy,
  close,
  submit,
}: {
  source: Source;
  choices: string[];
  busy: boolean;
  close: () => void;
  submit: (resources: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(choices.slice(0, 1)),
    [consent, setConsent] = useState(false);
  function send(e: FormEvent) {
    e.preventDefault();
    submit(picked);
  }
  return (
    <Modal title={`Подключение ${sourceNames[source]} · демо`} close={close}>
      <p className="callout">
        Это имитация подключения. Реальные аккаунты не используются.
      </p>
      <form onSubmit={send}>
        <fieldset>
          <legend>Какие данные разрешить анализировать</legend>
          {choices.map((resource) => (
            <label className="check" key={resource}>
              <input
                type="checkbox"
                checked={picked.includes(resource)}
                onChange={(e) =>
                  setPicked(
                    e.target.checked
                      ? [...picked, resource]
                      : picked.filter((x) => x !== resource),
                  )
                }
              />
              {resource}
            </label>
          ))}
        </fieldset>
        <label className="check consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
          />
          Разрешаю показывать анализ этих источников в кабинете HR и моего
          руководителя.
        </label>
        <button
          className="primary-button full"
          disabled={busy || !consent || !picked.length}
        >
          Подключить
        </button>
      </form>
    </Modal>
  );
}
