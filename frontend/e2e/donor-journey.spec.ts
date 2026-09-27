/**
 * e2e/donor-journey.spec.ts — End-to-end test covering the full donor journey.
 * Flow: visit /projects → select project → connect mock wallet → donate 10 XLM → verify badge updated to Seedling.
 * Resolves #1170.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { mockFreighter } from "./helpers/mockFreighter";

const MOCK_PROJECT_ID = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
const MOCK_WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
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
  min_donation_amount: "10000000",
  status: "active",
  verified: true,
  onChainVerified: true,
  tags: ["reforestation", "amazon"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ok = (data: unknown) => ({ json: { success: true, data } });

async function setupApiMocks(page: Page) {
  await page.route("**/api/**", (r: Route) => r.fulfill(ok([])));
  await page.route("**/horizon-testnet.stellar.org/**", (r) =>
    r.fulfill({
      json: {
        _embedded: { records: [] },
        id: "mock_account",
        sequence: "123456",
        balances: [{ asset_type: "native", balance: "500.0000000" }],
        hash: "mock_tx_hash_12345",
        successful: true,
      },
    }),
  );

  // Stats / categories / leaderboard
  await page.route("**/api/**/stats/categories", (r) => r.fulfill(ok([{ category: "Reforestation", count: 1 }])));
  await page.route("**/api/**/stats/global", (r) => r.fulfill(ok({ totalDonations: 1, totalXLMRaised: "100", totalCO2OffsetKg: 1000 })));

  // Profile
  await page.route(`**/api/**/profiles/${MOCK_PUBLIC_KEY}`, (r) =>
    r.fulfill(
      ok({
        publicKey: MOCK_PUBLIC_KEY,
        displayName: "EcoHero",
        totalDonatedXLM: "10",
        projectsSupported: 1,
        badges: [{ tier: "seedling", earnedAt: new Date().toISOString() }],
        badgeTier: "seedling",
      }),
    ),
  );

  // Donations record endpoint
  await page.route("**/api/**/donations", (r) =>
    r.fulfill(
      ok({
        id: "donation-e2e-123",
        projectId: MOCK_PROJECT_ID,
        donorAddress: MOCK_PUBLIC_KEY,
        amount: "10",
        currency: "XLM",
        transactionHash: "mock_tx_hash_12345",
        badge: "Seedling",
      }),
    ),
  );

  // Projects endpoints
  await page.route("**/api/**/projects", (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/**/projects?**", (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route(`**/api/**/projects/${MOCK_PROJECT_ID}/**`, (r) => r.fulfill(ok([])));
  await page.route(new RegExp(`/api/(v1/)?projects/${MOCK_PROJECT_ID}(\\?.*)?$`), (r) => r.fulfill(ok(MOCK_PROJECT)));
}

test.describe("Full donor journey (visit → donate → receive badge)", () => {
  test("donor visits /projects, selects project, connects wallet, donates 10 XLM, and verifies Seedling badge", async ({ page }) => {
    await setupApiMocks(page);
    await mockFreighter(page, MOCK_PUBLIC_KEY);

    // 1. Visit /projects
    await page.goto("/projects");
    await expect(page.getByText(MOCK_PROJECT.name)).toBeVisible();

    // 2. Select project
    await page.getByText(MOCK_PROJECT.name).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT_ID}`));

    // 3. Verify donation form is ready with connected mock wallet
    const form = page.locator(".card", { hasText: /make a donation/i });
    await expect(form.getByRole("heading", { name: /make a donation/i })).toBeVisible();

    // 4. Select or enter 10 XLM donation
    const preset10 = form.getByRole("button", { name: /^10 XLM$/i });
    if (await preset10.isVisible()) {
      await preset10.click();
    } else {
      const amountInput = form.getByPlaceholder(/or enter custom amount/i);
      await amountInput.fill("10");
    }

    // 5. Submit donation
    const donateButton = form.getByRole("button", { name: /Donate/i });
    await expect(donateButton).toBeEnabled();
    await donateButton.click();

    // 6. Verify success confirmation and badge
    await expect(page.getByText(/Transaction confirmed!/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Thank you!/i)).toBeVisible();

    // 7. Visit donor profile to verify Seedling badge
    await page.goto(`/donors/${MOCK_PUBLIC_KEY}`);
    await expect(page.getByText(/Seedling/i).first()).toBeVisible();
  });
});
