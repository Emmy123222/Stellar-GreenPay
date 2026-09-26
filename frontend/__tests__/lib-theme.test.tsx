/**
 * __tests__/lib-theme.test.tsx
 *
 * Unit tests for `lib/theme.tsx` — covers the ThemeProvider's
 * localStorage persistence, the `.dark` class application, the
 * `prefers-color-scheme` system fallback, and the `toggleTheme` flip.
 *
 * The test intentionally probes the provider via a small consumer
 * component rather than mounting the full Next app, so we exercise the
 * real React update path without dragging in `pages/_app.tsx` and its
 * many side-effectful children.
 */
import React from "react";
import { render, act, screen, fireEvent } from "@testing-library/react";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  ThemeProvider,
  applyThemeToDocument,
  useTheme,
} from "@/lib/theme";

beforeEach(() => {
  // Clean DOM + storage between tests so each case is isolated.
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  try {
    localStorage.clear();
  } catch {
    /* localStorage may be unavailable in some jsdom configs */
  }
  // JSDOM defaults to no `prefers-color-scheme` match; we explicitly
  // reset matchMedia below where it matters.
});

/** Tiny consumer that exposes the hook values as text so we can assert on them. */
function ExportProbe() {
  const ctx = useTheme();
  return (
    <div>
      <span data-testid="mounted">{String(ctx.mounted)}</span>
      <span data-testid="theme">{ctx.theme}</span>
      <span data-testid="effective">{ctx.effective}</span>
      <button data-testid="set-light" onClick={() => ctx.setTheme("light")}>
        light
      </button>
      <button data-testid="set-dark" onClick={() => ctx.setTheme("dark")}>
        dark
      </button>
      <button data-testid="set-system" onClick={() => ctx.setTheme("system")}>
        system
      </button>
      <button data-testid="toggle" onClick={() => ctx.toggleTheme()}>
        toggle
      </button>
    </div>
  );
}

describe("applyThemeToDocument", () => {
  it("adds the .dark class when the resolved theme is dark", () => {
    applyThemeToDocument("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("removes the .dark class when the resolved theme is light", () => {
    document.documentElement.classList.add("dark");
    applyThemeToDocument("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});

describe("ThemeProvider", () => {
  it("defaults to light when nothing is stored and the OS prefers light", () => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("effective").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolves to dark and applies the .dark class when OS prefers dark", () => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark"),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("effective").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persists the user's explicit choice to localStorage", () => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByTestId("set-dark"));
    });

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByTestId("effective").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggleTheme flips between light and dark and persists the new choice", () => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );

    // Start in light (system + light OS).
    expect(screen.getByTestId("effective").textContent).toBe("light");

    act(() => fireEvent.click(screen.getByTestId("toggle")));
    expect(screen.getByTestId("effective").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => fireEvent.click(screen.getByTestId("toggle")));
    expect(screen.getByTestId("effective").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("hydrates from a previously-stored dark preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("effective").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("ignores an unrecognised stored value and falls back to system", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "rainbow");
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("effective").textContent).toBe("light");
  });

  it("stores the preference under the greenpay:theme key (issue #1084)", () => {
    mockSystemDark(false);
    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-dark")));
    expect(THEME_STORAGE_KEY).toBe("greenpay:theme");
    expect(localStorage.getItem("greenpay:theme")).toBe("dark");
  });

  it("migrates a legacy greenpay-theme value to the new key", () => {
    mockSystemDark(false);
    localStorage.setItem("greenpay-theme", "dark");
    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("effective").textContent).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(localStorage.getItem("greenpay-theme")).toBeNull();
  });

  it("prefers the new key over a stale legacy value", () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    localStorage.setItem("greenpay-theme", "dark");
    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("effective").textContent).toBe("light");
  });

  it("an explicit choice overrides the OS preference after remount (new session)", () => {
    mockSystemDark(true);
    const first = render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );
    act(() => fireEvent.click(screen.getByTestId("set-light")));
    first.unmount();
    document.documentElement.classList.add("dark");

    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("syncs when another tab changes the stored theme", () => {
    mockSystemDark(false);
    render(
      <ThemeProvider>
        <ExportProbe />
      </ThemeProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }),
      );
    });
    expect(screen.getByTestId("effective").textContent).toBe("dark");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "unrelated", newValue: "light" }),
      );
    });
    expect(screen.getByTestId("effective").textContent).toBe("dark");
  });
});

function mockSystemDark(dark: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe("THEME_INIT_SCRIPT (pre-paint, runs before React)", () => {
  const runScript = () => new Function(THEME_INIT_SCRIPT)();
  const isDark = () => document.documentElement.classList.contains("dark");

  it("embeds the greenpay:theme key", () => {
    expect(THEME_INIT_SCRIPT).toContain('"greenpay:theme"');
  });

  it.each([
    // [stored, legacy, osDark, expectedDark]
    [null, null, false, false],
    [null, null, true, true],
    ["dark", null, false, true],
    ["light", null, true, false],
    ["system", null, true, true],
    ["system", null, false, false],
    ["rainbow", null, true, true],
    [null, "dark", false, true],
    ["light", "dark", false, false],
  ])(
    "stored=%p legacy=%p osDark=%p -> dark=%p",
    (stored, legacy, osDark, expectedDark) => {
      if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored);
      if (legacy !== null) localStorage.setItem("greenpay-theme", legacy);
      mockSystemDark(osDark);
      document.documentElement.classList.toggle("dark", !expectedDark);

      runScript();

      expect(isDark()).toBe(expectedDark);
      expect(document.documentElement.style.colorScheme).toBe(
        expectedDark ? "dark" : "light",
      );
    },
  );

  it("agrees with ThemeProvider for every stored value", () => {
    for (const stored of ["light", "dark", "system", null]) {
      for (const osDark of [false, true]) {
        localStorage.clear();
        if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
        mockSystemDark(osDark);
        runScript();
        const scriptDark = isDark();

        const { unmount } = render(
          <ThemeProvider>
            <ExportProbe />
          </ThemeProvider>,
        );
        expect(isDark()).toBe(scriptDark);
        unmount();
      }
    }
  });

  it("does not throw when localStorage is unavailable", () => {
    const spy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      expect(runScript).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
