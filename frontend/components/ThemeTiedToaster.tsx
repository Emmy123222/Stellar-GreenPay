/**
 * components/ThemeTiedToaster.tsx
 *
 * Thin wrapper around `sonner`'s Toaster that reads the resolved theme
 * from our `ThemeProvider` and provides accessible screen-reader live regions.
 *
 * Sonner's `theme` prop accepts the same `light | dark | system` vocabulary we use
 * in `lib/theme.tsx`, so we forward the resolved effective theme (always `light | dark`)
 * and keep the toast palette in sync.
 *
 * Screen Reader Accessibility Convention:
 * - Status & success notifications sit in a polite live region (`role="status"`, `aria-live="polite"`).
 * - Error notifications sit in an assertive live region (`role="alert"`, `aria-live="assertive"`).
 * - Sonner handles visual presentation; the accompanying `SonnerScreenReaderLiveRegions`
 *   mirrors toast events into polite or assertive live regions (hidden visually via `.sr-only`)
 *   so screen readers receive correct urgency cues.
 */
import { Toaster, useSonner } from "sonner";
import { useTheme } from "@/lib/theme";

/**
 * Accessible live regions for Sonner toasts.
 *
 * Sonner renders notifications visually in its own portal, but only outputs a single
 * polite section container without differentiating alert urgency for errors.
 * This companion component subscribes to the Sonner toast store using `useSonner()`
 * and mirrors messages into dedicated accessible live regions:
 * - Status / success / info toasts sit in `role="status"` / `aria-live="polite"`
 * - Error toasts sit in `role="alert"` / `aria-live="assertive"`
 */
function SonnerScreenReaderLiveRegions() {
  const { toasts } = useSonner();
  const statusToasts = toasts.filter((t) => t.type !== "error");
  const errorToasts = toasts.filter((t) => t.type === "error");

  const renderToastText = (t: (typeof toasts)[number]) => {
    const title = typeof t.title === "function" ? t.title() : t.title;
    const desc =
      typeof t.description === "function" ? t.description() : t.description;

    return (
      <div key={t.id}>
        {title && <span>{title}</span>}
        {desc && <span>{desc}</span>}
      </div>
    );
  };

  return (
    <div className="sr-only">
      <div role="status" aria-live="polite" aria-atomic="true">
        {statusToasts.map(renderToastText)}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {errorToasts.map(renderToastText)}
      </div>
    </div>
  );
}

export function ThemeTiedToaster() {
  const { effective } = useTheme();
  return (
    <>
      <Toaster
        theme={effective}
        position="top-right"
        toastOptions={{
          duration: 4000,
          // Inline styles survive sonner portal/shadow-DOM fallbacks,
          // unlike arbitrary Tailwind class strings in `className`.
          style:
            effective === "dark"
              ? {
                  background: "#102214",
                  color: "#e6f5e9",
                  border: "1px solid rgba(96, 208, 123, 0.30)",
                  borderRadius: "0.75rem",
                  fontSize: "0.875rem",
                  fontFamily: "'Nunito', sans-serif",
                }
              : {
                  background: "#ffffff",
                  color: "#1a2e1a",
                  border: "1px solid rgba(34, 114, 57, 0.20)",
                  borderRadius: "0.75rem",
                  fontSize: "0.875rem",
                  fontFamily: "'Nunito', sans-serif",
                },
        }}
      />
      <SonnerScreenReaderLiveRegions />
    </>
  );
}

