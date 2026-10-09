/**
 * __tests__/lib-i18n.test.tsx
 *
 * Unit tests for `lib/i18n.tsx` — covers the I18nProvider's
 * `greenpay:locale` persistence, the migration off the legacy `"locale"`
 * key, the `navigator.language` fallback, and the `<html lang>` sync.
 *
 * Same probe-based approach as `__tests__/lib-theme.test.tsx`: we mount
 * a tiny consumer instead of the whole Next app, so the real React
 * update path is exercised without pulling in `_app.tsx`.
 */
import React from "react";
import { render, act, screen, fireEvent } from "@testing-library/react";
import {
  DEFAULT_LOCALE,
  I18nProvider,
  LOCALE_STORAGE_KEY,
  applyLocaleToDocument,
  detectBrowserLocale,
  isLocale,
  readStoredLocale,
  useI18n,
  type Locale,
} from "@/lib/i18n";
import { formatXLM } from "@/utils/format";

function setNavigatorLocale(value: string | null, preferred?: string[]) {
  if (preferred) {
    Object.defineProperty(window.navigator, "languages", {
      value: preferred,
      configurable: true,
    });
  }
  Object.defineProperty(window.navigator, "language", {
    value: value ?? "en-US",
    configurable: true,
  });
}

/** Tiny consumer that exposes the hook values as text so we can assert on them. */
function LocaleProbe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="nav-home">{t("nav.home")}</span>
      <button data-testid="set-fr" onClick={() => setLocale("fr")}>
        fr
      </button>
      <button data-testid="set-es" onClick={() => setLocale("es")}>
        es
      </button>
      <button data-testid="set-bogus" onClick={() => setLocale("pirate" as Locale)}>
        bogus
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <I18nProvider>
      <LocaleProbe />
    </I18nProvider>,
  );
}

// Two tests below replace `window.localStorage` with a throwing stub to
// simulate private mode; keep the real descriptor so we can put it back.
const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

function stubOutLocalStorage() {
  const fail = () => {
    throw new Error("SecurityError");
  };
  Object.defineProperty(window, "localStorage", {
    value: { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail },
    configurable: true,
  });
}

beforeEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(window, "localStorage", originalLocalStorage);
  }
  document.documentElement.lang = "en";
  try {
    localStorage.clear();
  } catch {
    /* localStorage may be unavailable in some jsdom configs */
  }
  setNavigatorLocale("en-US", ["en-US"]);
});

describe("isLocale", () => {
  it("accepts only the shipped locale codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("readStoredLocale", () => {
  it("returns null when nothing is stored", () => {
    expect(readStoredLocale()).toBeNull();
  });

  it("reads the namespaced key", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(readStoredLocale()).toBe("fr");
  });

  it("migrates a value saved under the legacy `locale` key", () => {
    localStorage.setItem("locale", "es");
    expect(readStoredLocale()).toBe("es");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(localStorage.getItem("locale")).toBeNull();
  });

  it("ignores an unrecognised stored value instead of trusting it", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "klingon");
    localStorage.setItem("locale", "binary");
    expect(readStoredLocale()).toBeNull();
  });

  it("fails open to null when localStorage throws", () => {
    stubOutLocalStorage();

    expect(readStoredLocale()).toBeNull();
  });
});

describe("detectBrowserLocale", () => {
  it("uses navigator.language when navigator.languages is unavailable", () => {
    Object.defineProperty(window.navigator, "languages", {
      value: undefined,
      configurable: true,
    });
    setNavigatorLocale("fr-CA");
    expect(detectBrowserLocale()).toBe("fr");
  });

  it("walks navigator.languages in preference order", () => {
    setNavigatorLocale("de-DE", ["de-DE", "es-MX"]);
    expect(detectBrowserLocale()).toBe("es");
  });

  it("falls back to the default locale for unsupported browsers", () => {
    setNavigatorLocale("zu-ZA", ["zu"]);
    expect(detectBrowserLocale()).toBe(DEFAULT_LOCALE);
  });
});

describe("applyLocaleToDocument", () => {
  it("writes the lang attribute on <html>", () => {
    applyLocaleToDocument("es");
    expect(document.documentElement.lang).toBe("es");
  });
});

describe("I18nProvider", () => {
  it("applies the browser language when no preference is stored", () => {
    setNavigatorLocale("fr-FR", ["fr-FR"]);

    renderProvider();

    expect(screen.getByTestId("locale").textContent).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("hydrates the persisted preference across sessions", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    setNavigatorLocale("en-US", ["en-US"]);

    renderProvider();

    expect(screen.getByTestId("locale").textContent).toBe("fr");
    expect(screen.getByTestId("nav-home").textContent).toBe("Accueil");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("persists an explicit choice so a reload keeps it", () => {
    setNavigatorLocale("en-US", ["en-US"]);
    const first = renderProvider();

    act(() => {
      fireEvent.click(screen.getByTestId("set-fr"));
    });

    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");
    expect(screen.getByTestId("nav-home").textContent).toBe("Accueil");
    expect(document.documentElement.lang).toBe("fr");

    // "Reload": unmount, then mount a fresh provider from storage alone.
    first.unmount();
    renderProvider();

    expect(screen.getByTestId("locale").textContent).toBe("fr");
    expect(screen.getByTestId("nav-home").textContent).toBe("Accueil");
  });

  it("keeps <html lang> in sync when the locale changes", () => {
    renderProvider();
    expect(document.documentElement.lang).toBe("en");

    act(() => {
      fireEvent.click(screen.getByTestId("set-es"));
    });

    expect(document.documentElement.lang).toBe("es");
    expect(screen.getByTestId("nav-home").textContent).toBe("Inicio");
    expect(formatXLM(1234.56)).toContain(",56 XLM");
  });

  it("ignores an unsupported locale request", () => {
    renderProvider();

    act(() => {
      fireEvent.click(screen.getByTestId("set-bogus"));
    });

    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("still renders when localStorage is unavailable", () => {
    stubOutLocalStorage();

    renderProvider();

    expect(screen.getByTestId("locale").textContent).toBe("en");
    act(() => {
      fireEvent.click(screen.getByTestId("set-fr"));
    });
    expect(screen.getByTestId("nav-home").textContent).toBe("Accueil");
  });
});
