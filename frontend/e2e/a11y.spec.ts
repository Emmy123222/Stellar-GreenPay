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
const MOCK_PUBLIC_KEY = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP";
const MOCK_WALLET     = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

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
  badges: ["tree"],
  badgeTier: "tree",
};

const ok = (data: unknown) => ({ json: { success: true, data } });

// ── Route mock helper ─────────────────────────────────────────────────────────

async function mockApi(page: Page) {
  // Catch-all first (lowest priority due to reverse insertion order)
  await page.route("**/api/**", (r) => r.fulfill(ok([])));
  await page.route("**/horizon-testnet.stellar.org/**", (r) =>
    r.fulfill({ json: { _embedded: { records: [] }, balances: [{ asset_type: "native", balance: "500.0000000" }] } })
  );

  await page.route("**/api/stats/global",   (r) => r.fulfill(ok({ totalDonations: 1, totalXLMRaised: "100", totalCO2OffsetKg: 1000 })));
  await page.route("**/api/stats/categories", (r) => r.fulfill(ok([{ category: "Reforestation", count: 1 }])));
  await page.route("**/api/leaderboard**",  (r) => r.fulfill(ok([])));
  await page.route("**/api/donations/**",   (r) => r.fulfill(ok([])));
  await page.route("**/api/updates/**",     (r) => r.fulfill(ok([])));
  await page.route("**/api/subscriptions/**", (r) => r.fulfill({ json: { success: true, count: 0 } }));

  await page.route("**/api/profiles/**",    (r) => r.fulfill(ok(MOCK_PROFILE)));

  await page.route("**/api/projects?**",              (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/projects",                 (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/projects/featured",        (r) => r.fulfill(ok(MOCK_PROJECT)));
  await page.route(`**/api/projects/${MOCK_PROJECT_ID}/**`, (r) => r.fulfill(ok([])));
  await page.route(`**/api/projects/${MOCK_PROJECT_ID}`,    (r) => r.fulfill(ok(MOCK_PROJECT)));
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Accessibility (axe)", () => {
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
    // Wait for profile to load (skeleton disappears when profile renders)
    await page.waitForFunction(() => document.title && document.title.trim().length > 0);
    await assertNoCriticalViolations(page);
  });
});
