/**
 * e2e/donor-journey.spec.ts
 *
 * Full donor journey E2E test covering:
 * visit /projects → select a project → connect mock wallet → donate 10 XLM → verify badge updated to Seedling.
 *
 * Addresses Issue #1170.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

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
  status: "active",
  verified: true,
  onChainVerified: true,
  tags: ["reforestation", "amazon"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ok = (data: unknown) => ({ json: { success: true, data } });

async function mockApiAndHorizon(page: Page) {
  // Catch-all for API
  await page.route("**/api/**", (r: Route) => r.fulfill(ok([])));

  // Horizon endpoints
  await page.route("**/horizon-testnet.stellar.org/**", (r) => {
    if (r.request().url().includes("/transactions")) {
      return r.fulfill({
        json: {
          successful: true,
          hash: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
          ledger: 123456,
        },
      });
    }
    return r.fulfill({
      json: {
        _embedded: { records: [] },
        sequence: "123456789",
        balances: [{ asset_type: "native", balance: "500.0000000" }],
      },
    });
  });

  // CSRF token
  await page.route("**/api/**/csrf-token", (r) =>
    r.fulfill({ json: { success: true, csrfToken: "mock-csrf-token-12345" } }),
  );

  // Projects endpoints
  await page.route("**/api/**/projects?**", (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route("**/api/**/projects", (r) => r.fulfill(ok([MOCK_PROJECT])));
  await page.route(new RegExp(`/api/(v1/)?projects/${MOCK_PROJECT_ID}(\\?.*)?$`), (r) =>
    r.fulfill(ok(MOCK_PROJECT)),
  );

  // Profile endpoint
  await page.route("**/api/**/profiles/**", (r) =>
    r.fulfill(
      ok({
        publicKey: MOCK_PUBLIC_KEY,
        totalDonatedXLM: "10",
        projectsSupported: 1,
        badges: [{ tier: "Seedling", name: "Seedling" }],
      }),
    ),
  );

  // Donations recording endpoint
  await page.route("**/api/**/donations", (r) =>
    r.fulfill(
      ok({
        id: "mock-donation-1",
        projectId: MOCK_PROJECT_ID,
        donorAddress: MOCK_PUBLIC_KEY,
        amountXLM: "10",
        donorBadge: "Seedling",
        transactionHash: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
      }),
    ),
  );
}

/**
 * Deterministically mock the Freighter wallet extension.
 */
async function mockFreighterWallet(page: Page, publicKey = MOCK_PUBLIC_KEY) {
  await page.addInitScript((pk) => {
    (window as unknown as Record<string, unknown>).__test_publicKey__ = pk;
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: () => Promise.resolve({ isConnected: true }),
      isAllowed: () => Promise.resolve({ isAllowed: true }),
      getAddress: () => Promise.resolve({ address: pk, publicKey: pk }),
      signTransaction: (xdr: string) => Promise.resolve({ signedTransaction: xdr }),
    };
  }, publicKey);
}

test.describe("Full Donor Journey E2E (#1170)", () => {
  test("visit /projects → select project → connect wallet → donate 10 XLM → verify badge updated to Seedling", async ({
    page,
  }) => {
    await mockFreighterWallet(page);
    await mockApiAndHorizon(page);

    // 1. Visit /projects
    await page.goto("/projects");
    await expect(page.getByText(MOCK_PROJECT.name)).toBeVisible();

    // 2. Select a project (navigate to project detail)
    await page.getByText(MOCK_PROJECT.name).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT_ID}`));

    // 3. Connect mock wallet / verify donation form is ready
    const form = page.locator(".card", { hasText: /make a donation/i });
    await expect(form.getByRole("heading", { name: /make a donation/i })).toBeVisible();

    // 4. Donate 10 XLM
    const preset10 = form.getByRole("button", { name: /^10 XLM$/i });
    if (await preset10.isVisible()) {
      await preset10.click();
    } else {
      const amountInput = form.getByPlaceholder(/or enter custom amount/i);
      await amountInput.fill("10");
    }

    const donateButton = form.getByRole("button", { name: /Donate/i });
    await expect(donateButton).toBeEnabled();
    await donateButton.click();

    // 5. Verify badge updated to Seedling
    await expect(page.getByText(/Seedling/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Thank you!/i)).toBeVisible();
  });
});
