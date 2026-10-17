/**
 * components/ToastNotification.tsx
 * Lightweight toast notifications (no external library).
 *
 * Screen Reader Accessibility Convention:
 * - Status & success toasts must sit in a polite live region (`role="status"`, `aria-live="polite"`).
 *   This ensures assistive technology announces feedback (e.g. donation success, badge unlock)
 *   without abruptly cutting off current speech.
 * - Error toasts must sit in an assertive live region (`role="alert"`, `aria-live="assertive"`).
 *   This ensures critical issues (e.g. transaction failure, submission errors) are announced immediately.
 * - Callers should specify `type: "error"` or `variant: "error"` for error toasts. Unspecified types
 *   default to polite status announcements.
 */
import { useEffect, useMemo, useState } from "react";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  type?: "status" | "success" | "info" | "error";
  variant?: "status" | "success" | "info" | "error";
};

export default function ToastNotification({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...toasts].sort((a, b) => a.createdAt - b.createdAt),
    [toasts],
  );

  useEffect(() => {
    if (sorted.length === 0) return;
    const timers: number[] = [];

    for (const toast of sorted) {
      // Begin exit a bit before removal so the slide-down animation plays.
      timers.push(
        window.setTimeout(() => {
          setExiting((prev) => new Set(prev).add(toast.id));
        }, 3600),
      );

      timers.push(
        window.setTimeout(() => {
          onDismiss(toast.id);
          setExiting((prev) => {
            const next = new Set(prev);
            next.delete(toast.id);
            return next;
          });
        }, 4000),
      );
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [sorted, onDismiss]);

  if (sorted.length === 0) return null;

  const statusToasts = sorted.filter(
    (t) => t.type !== "error" && t.variant !== "error",
  );
  const errorToasts = sorted.filter(
    (t) => t.type === "error" || t.variant === "error",
  );

  const renderToast = (t: ToastItem, isError: boolean) => {
    const isExiting = exiting.has(t.id);
    return (
      <div
        key={t.id}
        className={`pointer-events-auto rounded-2xl border ${
          isError
            ? "border-red-200 bg-red-50/95 dark:border-red-800 dark:bg-red-950/95 text-red-900 dark:text-red-100"
            : "border-forest-200 bg-white/95 text-forest-900"
        } backdrop-blur shadow-lg px-4 py-3 transition-all motion-reduce:transition-none duration-300 ${
          isExiting ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 border ${
              isError
                ? "bg-red-100 border-red-200 dark:bg-red-900/50 dark:border-red-800 text-red-600 dark:text-red-300"
                : "bg-forest-50 border-forest-100"
            }`}
          >
            {isError ? "⚠️" : "🍃"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm font-body">
              {t.title}
            </p>
            {t.description && (
              <p
                className={`text-xs mt-0.5 font-body ${
                  isError
                    ? "text-red-700 dark:text-red-300"
                    : "text-[var(--text-secondary)] dark:text-[#8aaa8a]"
                }`}
              >
                {t.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className={`text-sm leading-none px-2 py-1 rounded-lg transition-colors ${
              isError
                ? "text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200"
                : "text-[var(--text-tertiary)] dark:text-forest-300 hover:text-forest-700"
            }`}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,420px)] space-y-2 pointer-events-none">
      {statusToasts.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="space-y-2"
        >
          {statusToasts.map((t) => renderToast(t, false))}
        </div>
      )}
      {errorToasts.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="space-y-2"
        >
          {errorToasts.map((t) => renderToast(t, true))}
        </div>
      )}
    </div>
  );
}


