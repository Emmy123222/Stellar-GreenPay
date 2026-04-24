/**
 * components/ToastNotification.tsx
 * Lightweight toast notifications (no external library).
 */
import { useEffect, useMemo, useState } from "react";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
};

export default function ToastNotification({ toasts, onDismiss }: {
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
      timers.push(window.setTimeout(() => {
        setExiting((prev) => new Set(prev).add(toast.id));
      }, 3600));

      timers.push(window.setTimeout(() => {
        onDismiss(toast.id);
        setExiting((prev) => {
          const next = new Set(prev);
          next.delete(toast.id);
          return next;
        });
      }, 4000));
    }

    return () => { timers.forEach((t) => window.clearTimeout(t)); };
  }, [sorted, onDismiss]);

  if (sorted.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,420px)] space-y-2 pointer-events-none">
      {sorted.map((t) => {
        const isExiting = exiting.has(t.id);
        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-2xl border border-forest-200 bg-white/95 backdrop-blur shadow-lg px-4 py-3 transition-all duration-300 ${
              isExiting ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-forest-50 border border-forest-100 flex items-center justify-center text-lg flex-shrink-0">
                🍃
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-forest-900 text-sm font-body">
                  {t.title}
                </p>
                {t.description && (
                  <p className="text-xs text-[#5a7a5a] mt-0.5 font-body">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                className="text-[#8aaa8a] hover:text-forest-700 transition-colors text-sm leading-none px-2 py-1 rounded-lg"
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

