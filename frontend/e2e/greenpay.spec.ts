/**
 * e2e/greenpay.spec.ts — End-to-end tests for Stellar GreenPay key user journeys.
 *
 * Covers:
 * - Home page loads correctly
 * - Projects list and empty state
 * - Navigation to project details
 * - DonateForm validation and preset amounts (with mocked wallet)
 * - Leaderboard and dashboard (with and without wallet)
 */
import { test, expect, type Page } from "@playwright/test";

// ── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_PROJECT_ID = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
const MOCK_PROJECT = {
  id: MOCK_PROJECT_ID,
  name: "Amazon Reforestation Initiative",
  description: "Planting 1 million native trees in the Brazilian Amazon.",
  category: "Reforestation",
  location: "Brazil, South America",
  walletAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  goalXLM: "50000",
  raisedXLM: "18420",
  donorCount: 147,
  co2OffsetKg: 245000,
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
    publicKey: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP",
    displayName: "EcoChampion",
    totalDonatedXLM: "2500",
    projectsSupported: 5,
    topBadge: "earth",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mock the Freighter wallet globally via window.freighter.
 */
async function mockFreighter(page: Page, publicKey = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP") {
  await page.addInitScript((pk) => {
    (window as any).freighter = {
      isConnected: () => Promise.resolve(true),
      isAllowed: () => Promise.resolve(true),
      requestAccess: () => Promise.resolve(pk),
      getPublicKey: () => Promise.resolve(pk),
      signTransaction: (xdr: string) => Promise.resolve(xdr),
    };
  }, publicKey);
}

/**
 * Intercept backend API calls with deterministic mock responses.
 */
async function mockApi(page: Page) {
  await page.route(`**/api/projects/${MOCK_PROJECT_ID}`, (route) =>
    route.fulfill({ json: { success: true, data: MOCK_PROJECT } })
  );
  await page.route("**/api/projects**", (route) =>
    route.fulfill({ json: { success: true, data: [MOCK_PROJECT] } })
  );
  await page.route("**/api/leaderboard**", (route) =>
    route.fulfill({ json: { success: true, data: MOCK_LEADERBOARD } })
  );
  await page.route("**/api/donations/**", (route) =>
    route.fulfill({ json: { success: true, data: [] } })
  );
  await page.route("**/api/profiles/**", (route) =>
    route.fulfill({ json: { success: true, data: { publicKey: "G...", totalDonatedXLM: "0", badges: [] } } })
  );
  
  // Mock Horizon balance check
  await page.route("**/horizon-testnet.stellar.org/accounts/**", (route) =>
    route.fulfill({
      json: { balances: [{ asset_type: "native", balance: "500.0000000" }] },
    })
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Home Page", () => {
  test("loads with hero section, badge tiers, and category grid", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /fund the planet/i })).toBeVisible();
    
    // Badge tiers
    for (const badge of ["Seedling", "Tree", "Forest", "Earth Guardian"]) {
      await expect(page.getByText(badge).first()).toBeVisible();
    }

    // Categories
    await expect(page.getByRole("link", { name: /reforestation/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /solar energy/i })).toBeVisible();
  });
});

test.describe("Projects Page", () => {
  test("loads and shows project cards", async ({ page }) => {
    await mockApi(page);
    await page.goto("/projects");
    await expect(page.getByText("Amazon Reforestation Initiative")).toBeVisible();
  });

  test("shows empty state when no projects found", async ({ page }) => {
    await page.route("**/api/projects**", (route) =>
      route.fulfill({ json: { success: true, data: [] } })
    );
    await page.goto("/projects");
    await expect(page.getByText(/no projects found/i)).toBeVisible();
  });

  test("clicking a project card navigates to detail page", async ({ page }) => {
    await mockApi(page);
    await page.goto("/projects");
    await page.getByText("Amazon Reforestation Initiative").click();
    await expect(page).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT_ID}`));
  });
});

test.describe("Project Detail & DonateForm", () => {
  test("shows WalletConnect prompt when no wallet is connected", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/projects/${MOCK_PROJECT_ID}`);
    await expect(page.getByText(/connect your wallet to donate/i)).toBeVisible();
  });

  test.describe("With Connected Wallet", () => {
    test.beforeEach(async ({ page }) => {
      await mockFreighter(page);
      await mockApi(page);
      await page.goto(`/projects/${MOCK_PROJECT_ID}`);
    });

    test("preset amount buttons pre-fill the amount input correctly", async ({ page }) => {
      await expect(page.getByRole("heading", { name: /make a donation/i })).toBeVisible();

      const amountInput = page.getByPlaceholder(/or enter custom amount/i);
      
      await page.getByRole("button", { name: /^25 XLM$/i }).click();
      await expect(amountInput).toHaveValue("25");

      await page.getByRole("button", { name: /^100 XLM$/i }).click();
      await expect(amountInput).toHaveValue("100");
    });

    test("submit button is disabled when no amount is entered", async ({ page }) => {
      await expect(page.getByRole("heading", { name: /make a donation/i })).toBeVisible();
      
      const donateButton = page.getByRole("button", { name: /donate/i });
      const amountInput = page.getByPlaceholder(/or enter custom amount/i);

      await expect(donateButton).toBeDisabled();

      await amountInput.fill("10");
      await expect(donateButton).toBeEnabled();

      await amountInput.fill("");
      await expect(donateButton).toBeDisabled();
    });
  });
});

test.describe("Leaderboard", () => {
  test("loads and shows badge tier legend", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");
    await expect(page.getByText("Impact Badge Tiers")).toBeVisible();
    await expect(page.getByText("Seedling").first()).toBeVisible();
  });
});

test.describe("Dashboard", () => {
  test("shows WalletConnect when no wallet is connected", async ({ page }) => {
    await mockApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /my impact/i })).toBeVisible();
    await expect(page.getByText(/connect your wallet/i)).toBeVisible();
  });
});
