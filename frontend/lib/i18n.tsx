/**
 * lib/i18n.tsx — Lightweight i18n context with JSON locale files.
 *
 * Locale persistence follows the same strategy as `lib/theme.tsx`:
 * the preference lives in `localStorage` under the namespaced
 * `greenpay:locale` key, every read/write is wrapped in `try/catch`
 * (localStorage is unavailable in private mode and sandboxed frames),
 * and an unrecognised value is ignored rather than trusted.
 *
 * Hydration strategy: the server has no `localStorage` and no
 * `navigator`, so we intentionally keep the React state at
 * `DEFAULT_LOCALE` for the first client render too. That keeps the
 * hydrated tree identical to the server-rendered HTML. After mount we
 * read the stored preference (falling back to `navigator.language`) and
 * switch. The `<html lang>` attribute is set BEFORE that first paint by
 * the nonce'd inline script in `pages/_document.tsx`, which mirrors
 * `resolveInitialLocale()` so assistive tech and the browser UI are
 * never on the wrong language, even if the visible strings settle one
 * frame later.
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
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import { setFormattingLocale } from "./formatLocale";

export const SUPPORTED_LOCALES = ["en", "es", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "greenpay:locale";

/** Key used before the `greenpay:` namespace was introduced (#1073). */
const LEGACY_LOCALE_STORAGE_KEY = "locale";

const locales: Record<Locale, Record<string, any>> = { en, es, fr };

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (k) => k,
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // localStorage can be disabled (private mode, sandboxed iframe).
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Tolerated — the in-memory preference still applies for this tab.
  }
}

/**
 * Read the user's explicit choice. Values saved under the pre-namespace
 * `"locale"` key are migrated to `greenpay:locale` in place so existing
 * users don't silently lose their preference on upgrade.
 */
export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;

  const stored = safeGetItem(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;

  const legacy = safeGetItem(LEGACY_LOCALE_STORAGE_KEY);
  if (isLocale(legacy)) {
    safeSetItem(LOCALE_STORAGE_KEY, legacy);
    try {
      window.localStorage.removeItem(LEGACY_LOCALE_STORAGE_KEY);
    } catch {
      // Nothing to do; the new key is already authoritative.
    }
    return legacy;
  }

  return null;
}

/**
 * Best guess from the browser when the user has never chosen a language.
 * `navigator.languages` (preferred, ordered) first, then `navigator.language`.
 */
export function detectBrowserLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  const candidates = [
    ...(Array.isArray(window.navigator.languages) ? window.navigator.languages : []),
    window.navigator.language,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const base = candidate.slice(0, 2).toLowerCase();
    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}

/** Stored preference wins; otherwise the browser; otherwise English. */
export function resolveInitialLocale(): Locale {
  return readStoredLocale() ?? detectBrowserLocale();
}

/**
 * Keep the document's declared language in sync with what's rendered.
 * Exported so `pages/_document.tsx` can mirror the same intent in its
 * pre-hydration inline script.
 */
export function applyLocaleToDocument(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

function get(obj: Record<string, any>, path: string): string {
  return path.split(".").reduce((acc: any, part) => acc?.[part], obj) ?? path;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Deterministic across server and client for the first render; the
  // real preference is applied by the mount effect below.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // After mount, adopt the stored (or browser) preference. The ref guard
  // mirrors `lib/theme.tsx`: React Strict Mode fires this effect twice in
  // dev, and the second pass must not clobber a preference the user has
  // already changed in the meantime.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const initialLocale = resolveInitialLocale();
    setFormattingLocale(initialLocale);
    setLocaleState(initialLocale);
  }, []);

  useEffect(() => {
    applyLocaleToDocument(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setFormattingLocale(next);
    setLocaleState(next);
    if (typeof window !== "undefined") {
      safeSetItem(LOCALE_STORAGE_KEY, next);
    }
  }, []);

  const t = useCallback((key: string) => get(locales[locale], key), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
