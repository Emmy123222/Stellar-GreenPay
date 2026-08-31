import { createContext, useContext, useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

// Fired whenever this tab changes the theme, so this tab's own subscribers
// re-render too (the native "storage" event only fires in other tabs).
const THEME_CHANGED_EVENT = "greenpay:theme-changed";

function readTheme(): Theme {
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener(THEME_CHANGED_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGED_EVENT, callback);
}

function getServerTheme(): Theme {
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // localStorage/matchMedia aren't available during SSR, so this renders
  // "light" (matching the server) during SSR and initial hydration, then
  // swaps to the real stored/preferred theme right after mount —
  // useSyncExternalStore is the React-recommended way to do this without a
  // manual effect + setState.
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, getServerTheme);

  // Keep the DOM in sync with whatever theme is currently committed.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = readTheme() === "light" ? "dark" : "light";
    localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
