/**
 * components/__tests__/Navbar.test.tsx
 *
 * Covers the active-link contract of the Navbar:
 *   - the link matching the current route carries aria-current="page"
 *   - every other link is left unmarked
 *   - nested routes (/projects/p1) still mark their parent section
 *   - "/" does not swallow every route via prefix matching
 */
import { render, screen } from "@testing-library/react";
import Navbar from "../Navbar";

// ── Mock useRouter ────────────────────────────────────────────────────────────
// The active link is derived from router.pathname, so each test declares the
// route it wants to exercise via this mutable mock.
let mockPathname = "/";
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: mockPathname }),
}));

// ── Mock useI18n ──────────────────────────────────────────────────────────────
jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "nav.home":        "Home",
        "nav.projects":    "Projects",
        "nav.map":         "Map",
        "nav.jobs":        "Jobs",
        "nav.bridge":      "Bridge",
        "nav.impact":      "Impact",
        "nav.leaderboard": "Leaderboard",
        "nav.contributors": "Contributors",
        "nav.myImpact":    "My Impact",
        "nav.apply":       "Apply",
        "nav.testnet":     "Testnet",
        "nav.mainnet":     "Mainnet",
        "nav.disconnect":  "Disconnect",
        "nav.connectWallet": "Connect Wallet",
      };
      return translations[key] ?? key;
    },
  }),
}));

// ── Mock notification polling ─────────────────────────────────────────────────
// Keeps the component's mount effect inert so tests stay deterministic.
jest.mock("@/lib/api", () => ({
  fetchUnreadNotificationCount: jest.fn().mockResolvedValue(0),
}));

function renderNavbar(pathname: string) {
  mockPathname = pathname;
  return render(
    <Navbar publicKey={null} onConnect={jest.fn()} onDisconnect={jest.fn()} />
  );
}

describe("Navbar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("marks the projects link as the current page on /projects", () => {
    renderNavbar("/projects");

    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("leaves the remaining links unmarked", () => {
    renderNavbar("/projects");

    const unmarked = ["Home", "Map", "Jobs", "Bridge", "Impact", "Leaderboard", "Contributors", "My Impact", "Apply"];
    for (const name of unmarked) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("marks exactly one link as current", () => {
    renderNavbar("/leaderboard");

    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Leaderboard");
  });

  it("marks the parent section for a nested route", () => {
    renderNavbar("/projects/proj-1");

    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("does not let the home link match every route by prefix", () => {
    renderNavbar("/map");

    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");
  });

  it("marks home on the root route", () => {
    renderNavbar("/");

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
});
