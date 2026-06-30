import { test, expect, type Page } from "@playwright/test";

async function mockApplySubmission(page: Page) {
  const emailNotifications: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.route("**/api/v1/csrf-token", (route) =>
    route.fulfill({
      json: { success: true, csrfToken: "playwright-csrf-token" },
    }),
  );

  await page.route("**/api/v1/projects", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        json: {
          success: true,
          data: {
            id: "project-123",
            reviewTimeline: "3–5 business days",
          },
        },
      });
    }

    return route.fulfill({ json: { success: true, data: [] } });
  });

  await page.route("**/api/v1/admin/notifications", (route) => {
    const body = route.request().postDataJSON();
    emailNotifications.push(body as Record<string, unknown>);
    return route.fulfill({
      json: { success: true, message: "Admin notification queued" },
    });
  });

  return emailNotifications;
}

test.describe("Project verification apply form", () => {
  test("submits project details, shows success, and notifies the admin", async ({ page }) => {
    const emailNotifications = await mockApplySubmission(page);

    await page.goto("/apply");

    await expect(page.getByRole("heading", { name: /submit your project/i })).toBeVisible();

    await page.getByPlaceholder("Acme Climate Foundation").fill("Green Horizon");
    await page.getByPlaceholder("https://acme.org").fill("https://greenhorizon.org");
    await page.getByPlaceholder("Kenya").fill("Kenya");
    await page.getByPlaceholder("hello@acme.org").fill("hello@greenhorizon.org");
    await page.getByRole("button", { name: /^Next$/i }).click();

    await page.getByPlaceholder("Acme Solar Farm Phase 1").fill("Solar Microgrid Pilot");
    const projectDetailsCard = page.locator('.card', { hasText: 'Project Details' });
    await projectDetailsCard
      .locator('label:has-text("Category")')
      .locator('..')
      .locator('select')
      .selectOption('Solar Energy');
    await page.getByPlaceholder("Describe the project's goals, impact, and methods…").fill(
      "Community solar microgrid for underserved neighborhoods.",
    );
    await page.getByPlaceholder("Nairobi, Kenya").fill("Nairobi, Kenya");
    await page.getByPlaceholder("50000").fill("25000");
    await page.getByRole("button", { name: /^Next$/i }).click();

    const validWallet = `G${"A".repeat(55)}`;
    await page.getByPlaceholder("GABC…").fill(validWallet);
    await page.getByRole("button", { name: /^Next$/i }).click();

    await page.getByPlaceholder("Verra VM0007").fill("Verra VM0007");
    await page.getByPlaceholder("Gold Standard, Verra, etc.").fill("Gold Standard");
    await page.getByPlaceholder("1200").fill("1200");
    await page.getByLabel("CO₂ Reduction").check();
    await page.getByLabel("Tree Planting").check();

    const notificationRequest = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().includes("/api/v1/admin/notifications"),
    );

    await page.getByRole("button", { name: /submit project/i }).click();
    await notificationRequest;

    await expect(page.getByRole("heading", { name: /project submitted!/i })).toBeVisible();
    await expect(page.getByText(/thank you for submitting/i)).toBeVisible();

    expect(emailNotifications).toHaveLength(1);
    expect(emailNotifications[0]).toMatchObject({
      projectName: "Solar Microgrid Pilot",
      contactEmail: "hello@greenhorizon.org",
      impactMetrics: ["co2-reduction", "tree-planting"],
    });
  });
});
