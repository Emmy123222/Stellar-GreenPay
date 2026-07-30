/**
 * components/ThemeTiedToaster.tsx
 *
 * Thin wrapper around `sonner`'s Toaster that reads the resolved theme
 * from our `ThemeProvider`. Sonner's `theme` prop accepts the same
 * `light | dark | system` vocabulary we use in `lib/theme.tsx`, so we
 * forward the resolved effective theme (always `light | dark`) and
 * keep the toast palette in sync.
 *
 * This avoids the FOUC-class flicker that would otherwise appear when
 * the user toggles dark mode while a toast is on screen.
 */
import { Toaster } from "sonner";
import { useTheme } from "@/lib/theme";

export function ThemeTiedToaster() {
  const { effective } = useTheme();
  return (
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
  );
}
