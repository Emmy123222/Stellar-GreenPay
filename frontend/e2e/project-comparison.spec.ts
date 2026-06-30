import { test, expect, type Page } from "@playwright/test";

const MOCK_PROJECTS = [
  {
    id: "project-1",
    name: "Amazon Reforestation",
    category: "Reforestation",
    location: "Brazil",
    walletAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "50000",
    raisedXLM: "18420",
    donorCount: 147,
    co2OffsetKg: 245000,
    status: "active",
    verified: true,
    onChainVerified: true,
    tags: ["reforestation"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "project-2",
    name: "Solar Energy India",
    category: "Solar Energy",
    location: "India",
    walletAddress: "GBAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "30000",
    raisedXLM: "12000",
    donorCount: 85,
    co2OffsetKg: 180000,
    status: "active",
    verified: true,
    onChainVerified: false,
    tags: ["solar"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "project-3",
    name: "Ocean Cleanup Initiative",
    category: "Ocean Cleanup",
    location: "Pacific Ocean",
    walletAddress: "GCAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "40000",
    raisedXLM: "25000",
    donorCount: 210,
    co2OffsetKg: 150000,
    status: "active",
    verified: true,
    onChainVerified: true,
    tags: ["ocean"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "project-4",
    name: "Wind Farm Kenya",
    category: "Wind Energy",
    location: "Kenya",
    walletAddress: "GDAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "60000",
    raisedXLM: "10000",
    donorCount: 50,
    co2OffsetKg: 300000,
    status: "active",
    verified: false,
    onChainVerified: false,
    tags: ["wind"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

async function mockApi(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: { success: true, data: [] } }));
  await page.route("**/horizon-testnet.stellar.org/**", (r) =>
    r.fulfill({ json: { _embedded: { records: [] } } }),
  );
  await page.route("**/api/projects?**", (r) => r.fulfill({ json: { success: true, data: MOCK_PROJECTS } }));
  await page.route("**/api/projects", (r) => r.fulfill({ json: { success: true, data: MOCK_PROJECTS } }));
  await page.route("**/api/stats/global", (r) =>
    r.fulfill({ json: { success: true, data: { totalDonations: 1, totalXLMRaised: "100", totalCO2OffsetKg: 1000 } } }),
  );
}

test.describe("ProjectComparison modal", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await page.goto("/projects");
    await expect(page.getByText(MOCK_PROJECTS[0].name)).toBeVisible();
  });

  test("select 2 projects, open modal, assert stats appear side-by-side", async ({ page }) => {
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("checkbox").nth(1).check();
    await expect(page.getByText("2 selected for comparison")).toBeVisible();

    await page.getByRole("button", { name: /compare selected/i }).click();
    await expect(page.getByRole("heading", { name: /project comparison/i })).toBeVisible();

    await expect(page.getByText(MOCK_PROJECTS[0].name)).toBeVisible();
    await expect(page.getByText(MOCK_PROJECTS[1].name)).toBeVisible();
    await expect(page.getByText("CO2 per XLM")).toBeVisible();
    await expect(page.getByText("Progress %")).toBeVisible();
    await expect(page.getByText("Donor count")).toBeVisible();
  });

  test("select 3rd project; assert 4th checkbox is disabled", async ({ page }) => {
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("checkbox").nth(1).check();
    await page.getByRole("checkbox").nth(2).check();

    await expect(page.getByRole("checkbox").nth(3)).toBeDisabled();
  });

  test("clear selection and verify UI resets", async ({ page }) => {
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("checkbox").nth(1).check();
    await expect(page.getByText("2 selected for comparison")).toBeVisible();

    await page.getByRole("checkbox").nth(0).uncheck();
    await page.getByRole("checkbox").nth(1).uncheck();

    await expect(page.getByText("2 selected for comparison")).not.toBeVisible();
  });
});
