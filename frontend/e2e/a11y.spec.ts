/**
 * e2e/a11y.spec.ts
 * Accessibility tests using axe-playwright (resolves #154).
 *
 * Checks home, project detail, and donor profile pages for zero
 * critical/serious axe violations. All backend calls are mocked so the
 * suite runs headlessly in CI without live services.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ── Shared mock data ──────────────────────────────────────────────────────────

const MOCK_PROJECT_ID = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
const MOCK_PUBLIC_KEY = "GCXIWOIPXZ7TIMU4FQRNLOFXRY7HGHOE2OIJMJVCW7EK5QKPIOATGKNJ";
const MOCK_WALLET     = "GAF6M5I5RPS3KTU2RV77D6H47BLPNN52AUG22KSD4VEWLDBM7VDU6ZRZ";

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

const MOCK_PROFILE = {
  publicKey: MOCK_PUBLIC_KEY,
  displayName: "EcoChampion",
  totalDonatedXLM: "500",
  projectsSupported: 3,
  badges: [{ tier: "tree", earnedAt: new Date().toISOString() }],
  createdAt: new Date().toISOString(),
};

const ok = (data: unknown) => ({ json: { success: true, data } });

// ── Route mock helper ─────────────────────────────────────────────────────────

async function mockApi(page: Page) {
  // Catch-all first (lowest priority due to reverse insertion order)
  await page.route("**/api/**", (r) => r.fulfill(ok([])));
  await page.route("**/horizon-testnet.stellar.org/**", (r) =>
    r.fulfill({ json: { _embedded: { records: [] }, balances: [{ asset_type: "native", balance: "500.0000000" }] } })
  );

  await page.route("**/api/**/stats/global",   (r) => r.fulfill(ok({ totalDonations: 1, totalXLMRaised: "100", totalCO2OffsetKg: 1000 })));
  await page.route("**/api/**/stats/categories", (r) => r.fulfill(ok([{ category: "Reforestation", count: 1 }])));
  await page.route("**/api/**/leaderboard**",  (r) => r.fulfill(ok([])));
  await page.route("**/api/**/donations/**",   (r) => r.fulfill(ok([])));
  await page.route("**/api/**/updates/**",     (r) => r.fulfill(ok([])));
  await page.route("**/api/**/subscriptions/**", (r) => r.fulfill({ json: { success: true, count: 0 } }));

  await page.route("**/api/**/profiles/**",    (r) => r.fulfill(ok(MOCK_PROFILE)));

  await page.route("**/api/**/projects?**",              (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/**/projects",                 (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/**/projects/featured",        (r) => r.fulfill(ok(MOCK_PROJECT)));
  await page.route(`**/api/**/projects/${MOCK_PROJECT_ID}/**`, (r) => r.fulfill(ok([])));
  await page.route(new RegExp(`/api/(v1/)?projects/${MOCK_PROJECT_ID}(\\?.*)?$`), (r) => r.fulfill(ok(MOCK_PROJECT)));
}

// ── Axe helper — assert zero critical/serious violations ─────────────────────

async function assertNoCriticalViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  const critical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );

  expect(
    critical,
    `Found ${critical.length} critical/serious a11y violation(s):\n` +
      critical.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n")
  ).toHaveLength(0);
}

// Pages that form the common logged-out dashboard and project journeys. The
// API mock keeps these checks hermetic; no route-level finding is suppressed.
const DASHBOARD_ROUTES = [
  "/apply",
  `/donate/${MOCK_PROJECT_ID}`,
  "/leaderboard",
  "/leaderboard/history",
  "/compare",
  "/impact",
  "/governance",
  "/jobs",
  "/settings/notifications",
];

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Accessibility (axe)", () => {
  // Several pages wrap their content in a CSS fade-in animation on mount.
  // Without this, axe can sample computed colors mid-fade and report
  // spuriously low contrast ratios on nearly every element.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("home page has no critical/serious violations", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await assertNoCriticalViolations(page);
  });

  test("project detail page has no critical/serious violations", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/projects/${MOCK_PROJECT_ID}`);
    await assertNoCriticalViolations(page);
  });

  test("donor profile page has no critical/serious violations", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/donors/${MOCK_PUBLIC_KEY}`);
    // Wait for the loaded profile to render (rather than racing on
    // document.title, which next/head clears and re-inserts on every
    // render — sampling it mid-flight can see a transient empty value).
    await expect(page.getByRole("heading", { name: MOCK_PROFILE.displayName })).toBeVisible();
    await assertNoCriticalViolations(page);
  });

  test("project map page has no critical/serious violations and offers a list alternative", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");
    await expect(page.getByRole("heading", { name: /project world map/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /browse all projects \(list view\)/i })).toHaveAttribute("href", "/projects");
    await assertNoCriticalViolations(page);
  });

  for (const theme of ["light", "dark"] as const) {
    for (const route of DASHBOARD_ROUTES) {
      test(`${route} has no critical/serious violations in ${theme} theme`, async ({ page }) => {
        await page.addInitScript((savedTheme) => {
          window.localStorage.setItem("greenpay:theme", savedTheme);
        }, theme);
        await mockApi(page);
        await page.goto(route);
        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(/dark/);
        }
        await assertNoCriticalViolations(page);
      });
    }
  }
});
