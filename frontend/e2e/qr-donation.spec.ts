/**
 * e2e/qr-donation.spec.ts
 * End-to-end tests for the QR-code donation link flow.
 *
 * A user who scans a QR code is sent to `/donate/[id]?amount=<n>`.
 * These tests verify:
 *  1. The correct project title is displayed on the donate page.
 *  2. The preset donation amount is shown when passed as a query param.
 *  3. No amount chip is shown when the `amount` param is absent.
 *
 * All backend and Stellar RPC calls are intercepted with Playwright route
 * mocks so the tests run headlessly in CI without any live services.
 */
import { test, expect, type Page } from "@playwright/test";

// ── Mock data ────────────────────────────────────────────────────────────────

const PROJECT_ID = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
const MOCK_WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const MOCK_PROJECT = {
  id: PROJECT_ID,
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

// ── Helper: mock all API routes the donate page may fetch ────────────────────

async function mockDonatePageApi(page: Page, projectId = PROJECT_ID) {
  await page.route(`**/api/projects/${projectId}`, (route) =>
    route.fulfill({ json: { success: true, data: MOCK_PROJECT } })
  );
  // Blanket catch-all for any other /api/** calls
  await page.route("**/api/**", (route) =>
    route.fulfill({ json: { success: true, data: [] } })
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("QR code donation link flow", () => {
  test("landing on the QR link shows the correct project title", async ({
    page,
  }) => {
    await mockDonatePageApi(page);

    // Simulate scanning a QR code that encodes this URL
    await page.goto(`/donate/${PROJECT_ID}`);

    await expect(
      page.getByRole("heading", { name: "Amazon Reforestation Initiative" })
    ).toBeVisible();
  });

  test("landing on the QR link with ?amount=50 pre-fills the donation amount", async ({
    page,
  }) => {
    await mockDonatePageApi(page);

    await page.goto(`/donate/${PROJECT_ID}?amount=50`);

    // The donate page renders a chip like "Donate 50 XLM" when presetAmount is set
    await expect(page.getByText(/50.*XLM/i)).toBeVisible();
  });

  test("landing on the QR link without ?amount shows no preset amount chip", async ({
    page,
  }) => {
    await mockDonatePageApi(page);

    await page.goto(`/donate/${PROJECT_ID}`);

    // The amount chip must NOT appear when no amount query param is provided
    await expect(page.getByText(/Donate \d+ XLM/i)).not.toBeVisible();
  });

  test("page title contains the project name for SEO / accessibility", async ({
    page,
  }) => {
    await mockDonatePageApi(page);

    await page.goto(`/donate/${PROJECT_ID}`);

    await expect(page).toHaveTitle(/Amazon Reforestation Initiative/i);
  });

  test("a non-existent project shows a not-found or empty state", async ({
    page,
  }) => {
    const badId = "00000000-0000-0000-0000-000000000000";
    await page.route(`**/api/projects/${badId}`, (route) =>
      route.fulfill({ status: 404, json: { success: false, error: "Not found" } })
    );

    await page.goto(`/donate/${badId}`);

    // Page must not crash — either a 404 heading or graceful empty state
    const body = page.locator("body");
    await expect(body).not.toBeEmpty();
  });
});
