import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Level, Source, SourceStatus, Target } from "./types";

export const formats: Record<string, string> = {
  online: "Онлайн",
  offline: "Очно",
  self_paced: "В своём темпе",
  office: "Офис",
  hybrid: "Гибрид",
  remote: "Удалённо",
};
export const statuses: Record<string, string> = {
  completed: "Завершено",
  in_progress: "В процессе",
  dropped: "Прервано",
  declined: "Отказ",
  no_show: "Неявка",
  overdue: "Просрочено",
  pending: "Проверяет HR",
  approved: "Подтверждено",
  rejected: "Не подтверждено",
};
export const levels: Record<Level, string> = {
  high: "Высокий",
  medium: "Средний",
  planned: "Плановый",
};
export const sourceNames: Record<Source, string> = {
  github: "GitHub",
  jira: "Jira",
};
export const sourceStates: Record<SourceStatus, string> = {
  connected: "подключён",
  not_connected: "не подключён",
  no_account: "нет аккаунта",
};

export const dateText = (value: string) =>
  new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить действие";
export const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
export const targetText = (t: Target) =>
  `${t.role} · ${t.grade}${t.chosen ? "" : " (ориентир)"}`;
export function plural(n: number, one: string, few: string, many: string) {
  const tail = n % 10,
    tens = n % 100;
  return tail === 1 && tens !== 11
    ? one
    : tail >= 2 && tail <= 4 && (tens < 12 || tens > 14)
      ? few
      : many;
}

export function Modal({
  title,
  close,
  children,
  wide,
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
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={close}>
      <section
        ref={dialog}
        className={wide ? "modal wide" : "modal"}
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

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<number>(undefined);
  function show(text: string) {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(""), 4500);
  }
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function Bar({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="mini-track">
      <div
        className={`mini-fill ${tone ?? ""}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function PriorityBadge({ level }: { level: Level }) {
  return (
    <span className={`priority-badge ${level}`}>{levels[level]} приоритет</span>
  );
}

export function SourceBadge({
  source,
  status,
}: {
  source: Source;
  status: SourceStatus;
}) {
  return (
    <span className={`source-badge ${status}`}>
      {sourceNames[source]} · {sourceStates[status]}
    </span>
  );
}

export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: string;
}) {
  return (
    <div className={`panel metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
