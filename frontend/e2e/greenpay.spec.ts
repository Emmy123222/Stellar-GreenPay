/**
 * e2e/greenpay.spec.ts — End-to-end tests for the GreenPay user journeys.
 *
 * Each spec mocks every backend (`/api/**`) and Stellar (`horizon-testnet`)
 * endpoint the page touches, plus injects a fake `window.freighter` so the
 * connected-wallet branches render without a real extension.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

// ── Mock data ───────────────────────────────────────────────────────────────

const MOCK_PROJECT_ID = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
const MOCK_WALLET     = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const MOCK_PUBLIC_KEY = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP";

const MOCK_PROJECT = {
  id: MOCK_PROJECT_ID,
  name: "Amazon Reforestation Initiative",
  description: "Planting 1 million native trees in the Brazilian Amazon.",
  category: "Reforestation",
  location: "Brazil, South America",
  walletAddress: MOCK_WALLET,
  goalXLM: "50000",
  raisedXLM: "18420",
  donorCount: 147,
  co2OffsetKg: 245000,
  co2_per_xlm: 100,
  status: "active",
  verified: true,
  onChainVerified: true,
  tags: ["reforestation", "amazon"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_LEADERBOARD = [
  {
    rank: 1,
    publicKey: MOCK_PUBLIC_KEY,
    displayName: "EcoChampion",
    totalDonatedXLM: "2500",
    projectsSupported: 5,
    topBadge: "earth",
  },
];

const ok    = (data: unknown) => ({ json: { success: true, data } });
const okMsg = (msg: string)   => ({ json: { success: true, message: msg } });

// ── Mocking helpers ─────────────────────────────────────────────────────────

/**
 * Intercept every `/api/**` call the GreenPay frontend can make and reply
 * with deterministic mock data. Unspecified routes fall through to a
 * blanket `{success: true, data: []}` so the page never sees a network
 * error from a forgotten endpoint.
 */
async function mockApi(page: Page) {
  // Playwright resolves routes in reverse insertion order — register the
  // catch-all FIRST so the more-specific handlers below win.
  await page.route("**/api/**", (r: Route) => r.fulfill(ok([])));
  await page.route("**/horizon-testnet.stellar.org/**", (r) =>
    r.fulfill({ json: { _embedded: { records: [] }, balances: [{ asset_type: "native", balance: "500.0000000" }] } }),
  );

  // Stats / categories / impact / leaderboard.
  await page.route("**/api/impact/**",          (r) => r.fulfill(ok({})));
  await page.route("**/api/stats/categories",   (r) => r.fulfill(ok([{ category: "Reforestation", count: 1 }])));
  await page.route("**/api/stats/global",       (r) => r.fulfill(ok({ totalDonations: 1, totalXLMRaised: "100", totalCO2OffsetKg: 1000 })));
  await page.route("**/api/leaderboard**",      (r) => r.fulfill(ok(MOCK_LEADERBOARD)));

  // Profile, donations, subscriptions, updates.
  await page.route("**/api/profiles/**",        (r) => r.fulfill(ok({ publicKey: MOCK_PUBLIC_KEY, totalDonatedXLM: "0", projectsSupported: 0, badges: [] })));
  await page.route("**/api/donations",          (r) => r.fulfill(ok({ id: "d1" })));
  await page.route("**/api/donations/**",       (r) => r.fulfill(ok([])));
  await page.route("**/api/subscriptions",      (r) => r.fulfill(okMsg("subscribed")));
  await page.route("**/api/subscriptions/**",   (r) => r.fulfill({ json: { success: true, count: 0 } }));
  await page.route("**/api/updates/**",         (r) => r.fulfill(ok([])));

  // Projects (broadest first within this group, then more specific).
  await page.route("**/api/projects?**",                        (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/projects",                           (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/projects/featured",                  (r) => r.fulfill(ok(MOCK_PROJECT)));
  await page.route(`**/api/projects/${MOCK_PROJECT_ID}/**`,     (r) => r.fulfill(ok([])));
  await page.route(`**/api/projects/${MOCK_PROJECT_ID}`,        (r) => r.fulfill(ok(MOCK_PROJECT)));
}

/**
 * Inject a connected-wallet state into the app. The runtime cooperates
 * via a small test seam in `_app.tsx` that prefers
 * `window.__test_publicKey__` over the real Freighter handshake — the
 * `@stellar/freighter-api` v2 library otherwise routes most calls
 * through `window.postMessage` to the extension, which is brittle and
 * race-prone to mock. Setting this global short-circuits the entire
 * handshake while leaving production behavior untouched.
 */
async function mockFreighter(page: Page, publicKey = MOCK_PUBLIC_KEY) {
  await page.addInitScript((pk) => {
    (window as unknown as Record<string, unknown>).__test_publicKey__ = pk;
    // Keep window.freighter present so any code that does an
    // `isFreighterInstalled` check still sees a wallet.
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve({ isConnected: true }),
    };
  }, publicKey);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("Home page", () => {
  test("loads with hero, badge tiers, and category grid", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    // Hero — match the visible h1 text rather than the role+name lookup,
    // since the heading wraps a `<br/>` and gradient `<span>`.
    await expect(page.getByText("Fund the planet.").first()).toBeVisible();

    // All four on-chain badge tiers should be visible somewhere on the page.
    for (const badge of ["Seedling", "Tree", "Forest", "Earth Guardian"]) {
      await expect(page.getByText(badge).first()).toBeVisible();
    }

    // Category grid — links into /projects?category=...  (Reforestation
    // can also appear in the data-driven category-stats chart, so use
    // .first() to silence strict-mode multi-match violations.)
    await expect(page.getByRole("link", { name: /reforestation/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /solar energy/i }).first()).toBeVisible();
  });
});

test.describe("Projects page", () => {
  test("shows project cards", async ({ page }) => {
    await mockApi(page);
    await page.goto("/projects");
    await expect(page.getByText(MOCK_PROJECT.name)).toBeVisible();
  });

  test("shows empty state when API returns no projects", async ({ page }) => {
    await mockApi(page);
    // Override the projects list mock — registered AFTER mockApi so the
    // reverse-insertion-order tiebreaker picks this one.
    await page.route("**/api/projects",    (r) => r.fulfill(ok([])));
    await page.route("**/api/projects?**", (r) => r.fulfill(ok([])));
    await page.goto("/projects");
    await expect(page.getByText(/no projects found/i)).toBeVisible();
  });

  test("clicking a project card navigates to its detail page", async ({ page }) => {
    await mockApi(page);
    await page.goto("/projects");
    await page.getByText(MOCK_PROJECT.name).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT_ID}`));
  });
});

test.describe("Project detail & DonateForm", () => {
  test("shows the WalletConnect prompt when no wallet is connected", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/projects/${MOCK_PROJECT_ID}`);
    await expect(page.getByText(/connect your wallet to donate/i)).toBeVisible();
  });

  test.describe("with a connected (mocked) Freighter wallet", () => {
    test.beforeEach(async ({ page }) => {
      await mockFreighter(page);
      await mockApi(page);
      await page.goto(`/projects/${MOCK_PROJECT_ID}`);
    });

    test("preset amount buttons pre-fill the custom-amount input", async ({ page }) => {
      // Scope selectors to the donation form so we don't collide with the
      // CO₂-impact calculator preview that also renders "25 XLM" buttons.
      const form = page.locator(".card", { hasText: /make a donation/i });
      await expect(form.getByRole("heading", { name: /make a donation/i })).toBeVisible();
      const amountInput = form.getByPlaceholder(/or enter custom amount/i);

      await form.getByRole("button", { name: /^25 XLM$/i }).click();
      await expect(amountInput).toHaveValue("25");

      await form.getByRole("button", { name: /^100 XLM$/i }).click();
      await expect(amountInput).toHaveValue("100");
    });

    test("submit button is disabled until a valid amount is entered", async ({ page }) => {
      const form = page.locator(".card", { hasText: /make a donation/i });
      await expect(form.getByRole("heading", { name: /make a donation/i })).toBeVisible();
      const donateButton = form.getByRole("button", { name: /Donate/ });
      const amountInput  = form.getByPlaceholder(/or enter custom amount/i);

      await expect(donateButton).toBeDisabled();
      await amountInput.fill("10");
      await expect(donateButton).toBeEnabled();
      await amountInput.fill("");
      await expect(donateButton).toBeDisabled();
    });
  });
});

test.describe("Leaderboard", () => {
  test("loads and shows the badge tier legend", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");
    await expect(page.getByText("Impact Badge Tiers")).toBeVisible();
    await expect(page.getByText("Seedling").first()).toBeVisible();
  });
});

test.describe("Dashboard (My Impact)", () => {
  test("shows WalletConnect when no wallet is connected", async ({ page }) => {
    await mockApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /^my impact$/i })).toBeVisible();
    // The WalletConnect card renders a level-3 heading — assert on it
    // specifically to avoid the strict-mode ambiguity with the prompt copy.
    await expect(page.getByRole("heading", { name: /connect your wallet/i })).toBeVisible();
  });
});
