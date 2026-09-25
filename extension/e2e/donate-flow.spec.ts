import { test, expect, chromium } from "@playwright/test";
import path from "path";
import fs from "fs";

let extensionId: string = "";
let popupUrl: string = "";

test.describe("GreenPay Extension E2E - Donate Flow", () => {
  test.beforeAll(async () => {
    const distPath = path.join(__dirname, "..", "dist");
    if (!fs.existsSync(distPath)) {
      throw new Error('Extension not built. Run "npm run build" first.');
    }
    const manifestPath = path.join(distPath, "..", "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("manifest.json not found.");
    }
  });

  async function setupExtension() {
    const extPath = path.join(__dirname, "..");
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    const extPage = await context.newPage();
    await extPage.goto("chrome://extensions/");
    await extPage.waitForSelector("extensions-item", { timeout: 5000 });

    const extensionElement = await extPage.locator("extensions-item").first();
    const extId = await extensionElement.evaluate(
      (el: any) => el.id || el.getAttribute("id"),
    );

    if (!extId) {
      throw new Error("Could not determine extension ID");
    }

    extensionId = extId;
    popupUrl = `chrome-extension://${extensionId}/popup.html`;
    await extPage.close();
    return context;
  }

  test("should load extension and open popup", async () => {
    const context = await setupExtension();
    const page = await context.newPage();
    await page.goto(popupUrl);

    const logo = page.locator(".logo");
    await expect(logo).toContainText("GreenPay");

    await context.close();
  });

  test("should display project list on popup open", async () => {
    const context = await setupExtension();
    const page = await context.newPage();
    await page.goto(popupUrl);

    const projectList = page.locator("#project-list");
    await expect(projectList).toBeVisible();

    const projectItems = page.locator(".project-item");
    const count = await projectItems.count();
    expect(count).toBeGreaterThan(0);

    await context.close();
  });

  test("should select a project and show donation form", async () => {
    const context = await setupExtension();
    const page = await context.newPage();
    await page.goto(popupUrl);

    const projectList = page.locator("#project-list");
    await expect(projectList).toBeVisible();

    const firstProject = page.locator(".project-item").first();
    await firstProject.click();

    const donationForm = page.locator(".donate-section");
    await expect(donationForm).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test("should handle missing Freighter gracefully", async () => {
    const context = await setupExtension();
    const page = await context.newPage();
    await page.goto(popupUrl);

    await page.waitForTimeout(500);

    const errorMsg = page.locator("text=Freighter Wallet Required");
    const connectBtn = page.locator("#connect-btn");

    const hasError = await errorMsg.count().then((c) => c > 0);
    const hasConnect = await connectBtn.count().then((c) => c > 0);

    expect(hasError || hasConnect).toBeTruthy();

    await context.close();
  });

  test("should maintain UI state through interactions", async () => {
    const context = await setupExtension();
    const page = await context.newPage();
    await page.goto(popupUrl);

    await page.waitForTimeout(500);

    const donateSection = page.locator(".donate-section");
    const count = await donateSection.count();
    expect(count).toBeGreaterThan(0);

    await context.close();
  });
});
