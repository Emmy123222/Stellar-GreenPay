/**
 * @jest-environment jsdom
 *
 * components/__tests__/Navbar.test.tsx — covers the active-page
 * indication in the primary navigation.
 *
 * The active route already gets a highlight class, but a colour change is
 * invisible to assistive tech. These tests pin the `aria-current="page"`
 * contract so screen readers announce the current page, and guard the
 * nested-route matching that the highlight relies on.
 */
import { render, screen } from "@testing-library/react";

const mockPathname = jest.fn(() => "/");

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {}, pathname: mockPathname() }),
}));

jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  fetchUnreadNotificationCount: jest.fn().mockResolvedValue(0),
}));

import Navbar from "@/components/Navbar";

function renderNavbar(pathname: string) {
  mockPathname.mockReturnValue(pathname);
  return render(
    <Navbar publicKey={null} onConnect={jest.fn()} onDisconnect={jest.fn()} />,
  );
}

describe("Navbar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("marks the /projects link as the current page when on /projects", () => {
    renderNavbar("/projects");

    expect(screen.getByRole("link", { name: "nav.projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("does not mark other links as the current page", () => {
    renderNavbar("/projects");

    expect(screen.getByRole("link", { name: "nav.home" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "nav.map" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("keeps the current page in sync with the route", () => {
    renderNavbar("/leaderboard");

    expect(screen.getByRole("link", { name: "nav.leaderboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "nav.projects" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("marks the parent link for a nested route", () => {
    renderNavbar("/projects/proj-1");

    expect(screen.getByRole("link", { name: "nav.projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // "/" must not be treated as a parent of every route.
    expect(screen.getByRole("link", { name: "nav.home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("marks the home link only on the root route", () => {
    renderNavbar("/");

    expect(screen.getByRole("link", { name: "nav.home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "nav.projects" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
