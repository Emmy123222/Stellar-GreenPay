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
});
