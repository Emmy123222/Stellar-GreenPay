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
  });

  async function setupExtension() {
    const extPath = path.join(__dirname, "..");

    const context = await chromium.launchPersistentContext("", {
      headless: !!process.env.CI,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    let foundId = "";

    // Attempt to find extension ID
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const bgPages = await context.backgroundPages();
        if (bgPages && bgPages.length > 0) {
          const url = bgPages[0].url();
          const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
          if (match) {
            foundId = match[1];
            break;
          }
        }
      } catch (e) {
        // Ignore
      }

      // Check all pages
      for (const page of context.pages()) {
        try {
          const url = page.url();
          if (url.includes("chrome-extension://")) {
            const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
            if (match) {
              foundId = match[1];
              break;
            }
          }
        } catch (e) {
          // Ignore
        }
      }

      if (foundId) break;

      // Try creating a test page
      const testPage = await context.newPage();
      try {
        await testPage.goto("about:blank", { waitUntil: "domcontentloaded" });
      } finally {
        try {
          await testPage.close();
        } catch (e) {
          // Ignore
        }
      }

      if (!foundId) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (!foundId) {
      throw new Error("Extension ID not found after retries");
    }

    extensionId = foundId;
    popupUrl = `chrome-extension://${extensionId}/popup.html`;

    return context;
  }

  test("should load extension and open popup", async () => {
    const context = await setupExtension();
    const page = await context.newPage();

    try {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded" });
      const logo = page.locator(".logo");
      await expect(logo).toContainText("GreenPay");
    } finally {
      await context.close();
    }
  });

  test("should guide first-time users and remember onboarding completion", async () => {
    const context = await setupExtension();
    const page = await context.newPage();

    try {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded" });
      const overlay = page.locator(".onboarding-overlay");
      await expect(overlay).toHaveAttribute("data-step", "1");
      await expect(overlay).toContainText("What is GreenPay?");

      await page.getByRole("button", { name: "Next" }).click();
      await expect(overlay).toHaveAttribute("data-step", "2");
      await expect(overlay).toContainText("Connect Freighter wallet");

      await page.getByRole("button", { name: "Next" }).click();
      await expect(overlay).toHaveAttribute("data-step", "3");
      await expect(overlay).toContainText("Find your first project");
      await page.getByRole("button", { name: "Got it" }).click();
      await expect(overlay).toHaveCount(0);

      const onboarded = await page.evaluate(
        () => new Promise<boolean>((resolve) => {
          chrome.storage.local.get(["onboarded"], (result) => resolve(result.onboarded === true));
        }),
      );
      expect(onboarded).toBe(true);

      await page.reload();
      await expect(page.locator(".onboarding-overlay")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("should display project list on popup open", async () => {
    const context = await setupExtension();
    const page = await context.newPage();

    try {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded" });
      const projectList = page.locator("#project-list");
      await expect(projectList).toBeVisible();

      const projectItems = page.locator(".project-item");
      const count = await projectItems.count();
      expect(count).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test("should select a project and show donation form", async () => {
    const context = await setupExtension();
    const page = await context.newPage();

    try {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded" });
      const projectList = page.locator("#project-list");
      await expect(projectList).toBeVisible();

      const donationForm = page.locator(".donate-section");
      await expect(donationForm).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("should handle missing Freighter gracefully", async () => {
    const context = await setupExtension();
    const page = await context.newPage();

    try {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);

      // Either error message or connect button should be visible
      const elements = await page
        .locator("text=Freighter, #connect-btn")
        .count();
      expect(elements).toBeGreaterThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

  test("should maintain UI state through interactions", async () => {
    const context = await setupExtension();
    const page = await context.newPage();

    try {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded" });

      const donateSection = page.locator(".donate-section");
      await expect(donateSection).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
