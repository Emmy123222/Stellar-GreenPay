import { test, expect, type Page } from "@playwright/test";

const PROJECT_ID = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
const PROJECT = {
  id: PROJECT_ID,
  name: "Amazon Reforestation Initiative",
  description: "Planting native trees in the Brazilian Amazon.",
  category: "Reforestation",
  location: "Brazil",
  walletAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  goalXLM: "50000",
  raisedXLM: "18420",
  donorCount: 147,
  co2OffsetKg: 245000,
  co2_per_xlm: 100,
  status: "active",
  verified: true,
  onChainVerified: true,
  tags: [],
};

async function mockProject(page: Page) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const projectPath = new RegExp(`^/api/(v1/)?projects/${PROJECT_ID}$`);
    return route.fulfill({
      json: projectPath.test(url.pathname)
        ? { success: true, data: PROJECT }
        : { success: true, data: [] },
    });
  });
}

test.describe("monthly giving setup", () => {
  test.beforeEach(async ({ page }) => {
    await mockProject(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.getByRole("button", { name: "Give monthly" }).click();
    await expect(page.getByRole("heading", { name: "Monthly Giving Setup" })).toBeVisible();
  });

  test("saves the selected amount and duration", async ({ page }) => {
    await page.getByLabel("Amount (XLM)").fill("40");
    await page.getByRole("button", { name: "6 months" }).click();
    await page.getByRole("button", { name: "Save Monthly Giving" }).click();

    await expect(page.getByRole("heading", { name: "Monthly Giving Setup" })).not.toBeVisible();
    const subscriptions = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("greenpay_monthly_subscriptions") || "[]"),
    );
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({ amountXLM: "40.0000000", durationMonths: 6, status: "active" });
  });

  test("cancel closes the flow without creating a subscription", async ({ page }) => {
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Monthly Giving Setup" })).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("greenpay_monthly_subscriptions"))).toBeNull();
  });
});
