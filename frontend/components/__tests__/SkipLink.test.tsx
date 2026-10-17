/**
 * @jest-environment jsdom
 *
 * components/__tests__/SkipLink.test.tsx
 *
 * Tests for the accessible SkipLink component:
 * - Visually hidden by default with Tailwind `sr-only`
 * - Becomes visible on focus via `focus:not-sr-only`
 * - Focus management: activating moves focus to target landmark
 * - Translation support across locales (en, es, fr, ar)
 * - Tab order: acts as the first focusable element before page content
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider, LOCALE_STORAGE_KEY, useI18n, type Locale } from "@/lib/i18n";
import SkipLink from "@/components/SkipLink";

function LocaleSwitch({ locale }: { locale: Locale }) {
  const { setLocale } = useI18n();
  React.useEffect(() => {
    setLocale(locale);
  }, [locale, setLocale]);
  return null;
}

function renderWithI18n(ui: React.ReactNode, locale: Locale = "en") {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }

  return render(
    <I18nProvider>
      <LocaleSwitch locale={locale} />
      {ui}
    </I18nProvider>,
  );
}

describe("SkipLink", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  describe("Visibility and Accessibility", () => {
    test("is visually hidden with sr-only class by default", () => {
      renderWithI18n(<SkipLink />);
      const link = screen.getByRole("link", { name: "Skip to main content" });

      expect(link).toBeInTheDocument();
      expect(link.className).toContain("sr-only");
      expect(link.className).toContain("focus:not-sr-only");
    });

    test("targets #main-content by default", () => {
      renderWithI18n(<SkipLink />);
      const link = screen.getByRole("link", { name: "Skip to main content" });

      expect(link).toHaveAttribute("href", "#main-content");
    });

    test("supports custom targetId", () => {
      renderWithI18n(<SkipLink targetId="custom-section" />);
      const link = screen.getByRole("link", { name: "Skip to main content" });

      expect(link).toHaveAttribute("href", "#custom-section");
    });
  });

  describe("Focus Management", () => {
    test("activating the skip link moves focus to target element", () => {
      renderWithI18n(
        <div>
          <SkipLink />
          <main id="main-content" tabIndex={-1}>
            <h1>Main Page Title</h1>
          </main>
        </div>,
      );

      const link = screen.getByRole("link", { name: "Skip to main content" });
      const main = document.getElementById("main-content");
      expect(main).not.toBeNull();

      // Click / activate the link
      fireEvent.click(link);

      // Focus should now be on the main landmark
      expect(document.activeElement).toBe(main);
    });

    test("adds tabindex to target element if missing and moves focus", () => {
      renderWithI18n(
        <div>
          <SkipLink />
          <main id="main-content">
            <h1>No initial tabIndex</h1>
          </main>
        </div>,
      );

      const link = screen.getByRole("link", { name: "Skip to main content" });
      const main = document.getElementById("main-content")!;

      fireEvent.click(link);

      expect(main).toHaveAttribute("tabindex", "-1");
      expect(document.activeElement).toBe(main);
    });

    test("is the first focusable element in tab order", async () => {
      const user = userEvent.setup();

      renderWithI18n(
        <div>
          <SkipLink />
          <nav>
            <a href="/">Home</a>
            <a href="/projects">Projects</a>
          </nav>
          <main id="main-content" tabIndex={-1}>
            <button>Inside Main</button>
          </main>
        </div>,
      );

      const skipLink = screen.getByRole("link", { name: "Skip to main content" });

      // First tab stop must be the skip link
      await user.tab();
      expect(document.activeElement).toBe(skipLink);

      // Activating with enter key moves focus to main content
      await user.keyboard("{Enter}");
      const main = document.getElementById("main-content");
      expect(document.activeElement).toBe(main);
    });
  });

  describe("Translations", () => {
    test("renders English label", () => {
      renderWithI18n(<SkipLink />, "en");
      expect(
        screen.getByRole("link", { name: "Skip to main content" }),
      ).toBeInTheDocument();
    });

    test("renders Spanish label", () => {
      renderWithI18n(<SkipLink />, "es");
      expect(
        screen.getByRole("link", { name: "Saltar al contenido principal" }),
      ).toBeInTheDocument();
    });

    test("renders French label", () => {
      renderWithI18n(<SkipLink />, "fr");
      expect(
        screen.getByRole("link", { name: "Passer au contenu principal" }),
      ).toBeInTheDocument();
    });

    test("renders Arabic label", () => {
      renderWithI18n(<SkipLink />, "ar");
      expect(
        screen.getByRole("link", { name: "الانتقال إلى المحتوى الرئيسي" }),
      ).toBeInTheDocument();
    });
  });
});
