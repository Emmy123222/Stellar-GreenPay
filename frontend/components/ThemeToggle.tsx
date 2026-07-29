/**
 * components/ThemeToggle.tsx
 *
 * Navbar-mounted button that flips between light and dark mode using
 * `useTheme()` from `@/lib/theme`. Renders a sun icon when the active
 * theme is dark (clicking reverts to light) and a moon icon when it is
 * light (clicking activates dark mode). Persists the choice via the
 * ThemeProvider's localStorage write-through.
 */
import { useTheme } from "@/lib/theme";
import clsx from "clsx";

export default function ThemeToggle() {
  const { effective, toggleTheme, mounted } = useTheme();
  // Render a stable placeholder until we've actually mounted and read
  // localStorage. This avoids a hydration mismatch where the FOUC
  // inline script painted `<html class="dark">` but the server-rendered
  // React tree reported `effective="light"`.
  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center h-10 w-10 rounded-lg"
      />
    );
  }
  const isDark = effective === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={clsx(
        "inline-flex items-center justify-center h-10 w-10 rounded-lg transition-colors",
        "hover:bg-[rgba(34,114,57,0.06)] dark:hover:bg-[rgba(96,208,123,0.10)]",
        "text-[#5a7a5a] dark:text-[#b2d5b5]",
        "hover:text-[#227239] dark:hover:text-[#81c784]",
        "border border-transparent hover:border-[rgba(34,114,57,0.20)] dark:hover:border-[rgba(96,208,123,0.25)] dark:hover:bg-[#1c3928]",
        "focus:outline-none focus:ring-2 focus:ring-[rgba(34,114,57,0.30)] dark:focus:ring-[rgba(96,208,123,0.40)]",
      )}
    >
      {/* Sun icon — visible when active theme is dark (i.e. press to bring light) */}
      <svg
        className={clsx(
          "w-5 h-5 transition-opacity",
          isDark ? "opacity-0" : "opacity-100",
        )}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"
        />
      </svg>

      {/* Moon icon — visible when active theme is light (i.e. press to bring dark) */}
      <svg
        className={clsx(
          "w-5 h-5 transition-opacity",
          isDark ? "opacity-100" : "opacity-0",
        )}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
        />
      </svg>
    </button>
  );
}
