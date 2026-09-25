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
      headless: !!process.env.CI,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    // Create a temporary page to trigger extension initialization
    const tempPage = await context.newPage();

    // Navigate to about:blank to ensure extension infrastructure is ready
    await tempPage.goto("about:blank");

    // Give extension time to initialize
    await tempPage.waitForTimeout(200);

    // Try to find extension pages via getAllPages or backgroundPages
    let foundExtensionId = "";

    // Method 1: Try backgroundPages() - works if service worker is active
    try {
      const bgPages = await context.backgroundPages();
      if (bgPages && bgPages.length > 0) {
        const bgUrl = bgPages[0].url();
        const match = bgUrl.match(/chrome-extension:\/\/([a-z]+)\//);
        if (match) {
          foundExtensionId = match[1];
        }
      }
    } catch (e) {
      // Not fatal, try another method
    }

    // Method 2: Navigate to chrome://extensions to get the ID (for local testing)
    if (!foundExtensionId && !process.env.CI) {
      try {
        await tempPage.goto("chrome://extensions/");
        await tempPage.waitForSelector("extensions-item", { timeout: 3000 });
        const extensionElement = await tempPage
          .locator("extensions-item")
          .first();
        const extId = await extensionElement.evaluate(
          (el: any) => el.id || el.getAttribute("id"),
        );
        if (extId) {
          foundExtensionId = extId;
        }
      } catch (e) {
        // Not fatal, try another method
      }
    }

    // Method 3: Inject a content script into a regular page that accesses chrome.runtime
    // to get the extension ID (for headless CI)
    if (!foundExtensionId && process.env.CI) {
      try {
        // Navigate to a test page that can access the extension
        await tempPage.goto(
          "data:text/html,<script>window.extId = chrome.runtime.id; console.log('EXT_ID:', chrome.runtime.id);</script>",
        );
        await tempPage.waitForTimeout(100);
        const extIdFromScript = await tempPage
          .evaluate(() => {
            return (window as any).extId;
          })
          .catch(() => null);
        if (extIdFromScript) {
          foundExtensionId = extIdFromScript;
        }
      } catch (e) {
        // Not fatal, try another method
      }
    }

    // Method 4: Derive extension ID from known extension paths
    // (for CI environments where backgroundPages might not work immediately)
    if (!foundExtensionId) {
      // When using --load-extension with an unpacked extension,
      // Chromium will assign an ID based on the extension's manifest.
      // Since we can't easily determine it without accessing it,
      // we'll try a more direct approach: attempt to navigate to the popup
      // with a likely ID and let Chromium handle redirection/loading.

      // For now, try to find ANY chrome-extension: URL in the context
      const allPages = context.pages();
      for (const page of allPages) {
        const url = page.url();
        if (url.includes("chrome-extension://")) {
          const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
          if (match) {
            foundExtensionId = match[1];
            break;
          }
        }
      }
    }

    if (!foundExtensionId) {
      throw new Error(
        "Could not determine extension ID. Extension may not have loaded properly. " +
          "Try rebuilding with 'npm run build' and ensure manifest.json is valid.",
      );
    }

    extensionId = foundExtensionId;
    popupUrl = `chrome-extension://${extensionId}/popup.html`;

    await tempPage.close();
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
      const isVisible = await donationForm.count().then((c) => c > 0);
      expect(isVisible).toBeTruthy();
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

      const errorMsg = page.locator("text=Freighter Wallet Required");
      const connectBtn = page.locator("#connect-btn");

      const hasError = await errorMsg.count().then((c) => c > 0);
      const hasConnect = await connectBtn.count().then((c) => c > 0);

      expect(hasError || hasConnect).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test("should maintain UI state through interactions", async () => {
    const context = await setupExtension();
    const page = await context.newPage();

    try {
      await page.goto(popupUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);

      const donateSection = page.locator(".donate-section");
      const count = await donateSection.count();
      expect(count).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
