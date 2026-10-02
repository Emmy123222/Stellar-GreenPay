/**
 * lib/theme.tsx
 *
 * Three-state theme manager (`light` | `dark` | `system`) with
 * localStorage persistence. Sets / removes the `.dark` class on
 * `document.documentElement` so Tailwind's `dark:` variants flip the
 * whole app at once.
 *
 * Hydration strategy: we intentionally keep the React state at the
 * `defaultForHydration` value (`system`) for the first render so the
 * server-rendered HTML matches the FOUC inline script's painted
 * `<html class>`. After mount, we read localStorage and apply the
 * real stored preference. The `mountedRef` guard also survives React
 * Strict Mode's double-effect so the post-hydration flip only fires
 * once per session.
 *
 * The matching inline script in `pages/_document.tsx` runs BEFORE
 * React hydration and applies the same class so the user sees zero
 * theme flicker on first paint.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "greenpay:theme";

/**
 * Keys used by earlier releases. Read once, copied to THEME_STORAGE_KEY,
 * then removed, so users who already picked a theme keep it after upgrade.
 */
export const LEGACY_THEME_STORAGE_KEYS: readonly string[] = ["greenpay-theme"];

/**
 * Inline script rendered by `pages/_document.tsx` ahead of React. It
 * resolves the stored (or legacy) preference, falls back to
 * `prefers-color-scheme`, and sets `.dark` + `color-scheme` on <html>
 * before first paint. Built from the constants above so the key can't
 * drift between the pre-paint script and the provider.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=window.localStorage;var m=s.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(m===null){var l=${JSON.stringify(
  LEGACY_THEME_STORAGE_KEYS,
)};for(var i=0;i<l.length&&m===null;i++){m=s.getItem(l[i])}}var d;if(m==="dark"){d=true}else if(m==="light"){d=false}else{d=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)}var r=document.documentElement;if(d){r.classList.add("dark");r.style.colorScheme="dark"}else{r.classList.remove("dark");r.style.colorScheme="light"}}catch(e){}})();`;

interface ThemeContextValue {
  /** What the user has explicitly chosen (including "follow my OS"). */
  theme: ThemeMode;
  /** What is actually applied right now (after resolving "system"). */
  effective: EffectiveTheme;
  /** True once we've read localStorage and the OS preference after mount. */
  mounted: boolean;
  setTheme: (next: ThemeMode) => void;
  /** Convenience: flip between `light` and `dark` (used by the navbar). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  effective: "light",
  mounted: false,
  setTheme: () => {},
  toggleTheme: () => {},
});

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const storage = window.localStorage;
    const stored = storage.getItem(THEME_STORAGE_KEY);
    if (stored === null) {
      for (const legacyKey of LEGACY_THEME_STORAGE_KEYS) {
        const legacy = storage.getItem(legacyKey);
        if (legacy === null) continue;
        storage.removeItem(legacyKey);
        if (isThemeMode(legacy)) {
          storage.setItem(THEME_STORAGE_KEY, legacy);
          return legacy;
        }
      }
    }
    if (isThemeMode(stored)) {
      return stored;
    }
  } catch {
    // localStorage can be disabled in private mode — fail open to "system".
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Apply (or remove) the `.dark` class on <html>. Exported so the inline
 * script in `_document.tsx` can use the same logic for the pre-hydration
 * paint.
 */
export function applyThemeToDocument(theme: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  // Help browsers paint the right UA chrome (scrollbars, form controls)
  // and tell AT users which palette they're on.
  root.style.colorScheme = theme;
}

/**
 * Default `theme` value used during SSR + the very first client render.
 * Matches what the FOUC inline script will have painted, so React
 * hydration doesn't warn about a mismatched tree.
 */
const DEFAULT_FOR_HYDRATION: ThemeMode = "system";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] =
    useState<ThemeMode>(DEFAULT_FOR_HYDRATION);
  const [systemDark, setSystemDark] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  // After mount: pick up the real stored preference and current OS mode.
  // We use a ref guard so React Strict Mode's double-effect doesn't reset
  // the user's saved preference back to "system".
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setThemeState(readStoredTheme());
    setSystemDark(systemPrefersDark());
    setMounted(true);
  }, []);

  // Whenever `theme` or the OS preference changes, push the resolved
  // value into the DOM.
  const effective: EffectiveTheme = useMemo(
    () => (theme === "system" ? (systemDark ? "dark" : "light") : theme),
    [theme, systemDark],
  );

  useEffect(() => {
    applyThemeToDocument(effective);
  }, [effective]);

  // When the OS preference flips while we're in "system" mode, keep the
  // effective theme in sync.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    // `addEventListener` is the modern path; `addListener` is a Safari < 14
    // fallback. Guard with typeof so a missing implementation doesn't break.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  // Keep other open tabs in step when the user changes theme in one.
  // `storage` only fires in tabs other than the one that wrote the value.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      setThemeState(isThemeMode(e.newValue) ? e.newValue : "system");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // localStorage may be disabled (private mode, sandboxed iframe) —
        // tolerate it; the in-memory preference still applies for the
        // lifetime of this tab.
      }
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(effective === "dark" ? "light" : "dark");
  }, [effective, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, effective, mounted, setTheme, toggleTheme }),
    [theme, effective, mounted, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
