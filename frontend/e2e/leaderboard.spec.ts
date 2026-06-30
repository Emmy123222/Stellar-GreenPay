import { test, expect, type Page, type Route } from "@playwright/test";

const MOCK_PUBLIC_KEY = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP";
const MOCK_PUBLIC_KEY_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const MOCK_LEADERBOARD = [
  {
    rank: 1,
    publicKey: MOCK_PUBLIC_KEY,
    displayName: "EcoChampion",
    totalDonatedXLM: "5000",
    projectsSupported: 8,
    topBadge: "earth",
  },
  {
    rank: 2,
    publicKey: MOCK_PUBLIC_KEY_2,
    displayName: "GreenDonor",
    totalDonatedXLM: "1200",
    projectsSupported: 3,
    topBadge: "forest",
  },
  {
    rank: 3,
    publicKey: "GBCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGH",
    displayName: "TreeHugger",
    totalDonatedXLM: "500",
    projectsSupported: 2,
    topBadge: "tree",
  },
  {
    rank: 4,
    publicKey: "GDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJ",
    displayName: undefined,
    totalDonatedXLM: "50",
    projectsSupported: 1,
    topBadge: "seedling",
  },
];

const ok = (data: unknown) => ({ json: { success: true, data } });

async function mockApi(page: Page) {
  await page.route("**/api/**", (r: Route) => r.fulfill(ok([])));
  await page.route("**/horizon-testnet.stellar.org/**", (r) =>
    r.fulfill({
      json: {
        _embedded: { records: [] },
        balances: [{ asset_type: "native", balance: "500.0000000" }],
      },
    }),
  );
  await page.route("**/api/leaderboard**", (r) => r.fulfill(ok(MOCK_LEADERBOARD)));
  await page.route("**/api/stats/global", (r) =>
    r.fulfill(ok({ totalDonations: 1, totalXLMRaised: "100", totalCO2OffsetKg: 1000 })),
  );
  await page.route("**/api/stats/categories", (r) =>
    r.fulfill(ok([{ category: "Reforestation", count: 1 }])),
  );
}

test.describe("Leaderboard page", () => {
  test("donors are sorted by total XLM descending", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");

    const rows = page.locator(".space-y-2 > div");
    await expect(rows.first()).toBeVisible();

    const amounts = await rows.evaluateAll((els) =>
      els
        .map((el) => {
          const text = el.querySelector(".font-mono")?.textContent ?? "";
          const match = text.match(/([\d,.]+)/);
          return match ? parseFloat(match[1].replace(/,/g, "")) : 0;
        })
        .filter((n) => n > 0),
    );

    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i]).toBeLessThanOrEqual(amounts[i - 1]);
    }
  });

  test("badge icons appear for correct tiers", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");

    await expect(page.getByText("🌍").first()).toBeVisible();
    await expect(page.getByText("🌲").first()).toBeVisible();
    await expect(page.getByText("🌳").first()).toBeVisible();
    await expect(page.getByText("🌱").first()).toBeVisible();
  });

  test("clicking a donor name opens their public profile", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");

    const donorLink = page.getByText("EcoChampion").first();
    await expect(donorLink).toBeVisible();
    await donorLink.click();

    await expect(page).toHaveURL(new RegExp(MOCK_PUBLIC_KEY));
  });

  test("shows donor display names", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");

    await expect(page.getByText("EcoChampion")).toBeVisible();
    await expect(page.getByText("GreenDonor")).toBeVisible();
    await expect(page.getByText("TreeHugger")).toBeVisible();
  });

  test("shows fallback address when no display name", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");

    const fourthRow = page.locator(".space-y-2 > div").nth(3);
    await expect(fourthRow).toBeVisible();
  });

  test("shows badge tier legend", async ({ page }) => {
    await mockApi(page);
    await page.goto("/leaderboard");

    await expect(page.getByText("Impact Badge Tiers")).toBeVisible();
    await expect(page.getByText("Seedling").first()).toBeVisible();
    await expect(page.getByText("Earth Guardian").first()).toBeVisible();
  });
});
