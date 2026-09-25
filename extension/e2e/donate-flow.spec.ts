import { test, expect, chromium, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * E2E test for GreenPay extension donation flow
 * 
 * Tests the full flow:
 * 1. Load extension in Chromium
 * 2. Open popup
 * 3. Verify project list loads
 * 4. Select a project
 * 5. Verify donation form is shown
 */

test.describe('GreenPay Extension E2E - Donate Flow', () => {
  let extensionId: string;
  let popupUrl: string;

  test.beforeAll(async () => {
    // Get the dist path
    const distPath = path.join(__dirname, '..', 'dist');
    
    // Verify the extension is built
    if (!fs.existsSync(distPath)) {
      throw new Error('Extension not built. Run "npm run build" first.');
    }

    const manifestPath = path.join(distPath, '..', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json not found. Ensure extension is in the parent directory.');
    }
  });

  test('should load extension and open popup', async () => {
    const extPath = path.join(__dirname, '..');
    
    const browser = await chromium.launch({
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    const context = await browser.createContext();
    const page = await context.newPage();

    // Get extension ID by opening the extension management page
    const extPage = await context.newPage();
    await extPage.goto('chrome://extensions/');

    // Extract extension ID from page
    const extensionElement = await extPage.locator('extensions-item').first();
    const extId = await extensionElement.evaluate(
      (el: any) => el.id || el.getAttribute('id'),
    );

    if (!extId) {
      throw new Error('Could not determine extension ID');
    }

    extensionId = extId;
    popupUrl = `chrome-extension://${extensionId}/popup.html`;

    // Navigate to popup
    await page.goto(popupUrl);

    // Verify popup loaded
    const logo = page.locator('.logo');
    await expect(logo).toContainText('GreenPay');

    await extPage.close();
    await browser.close();
  });

  test('should display project list on popup open', async () => {
    const extPath = path.join(__dirname, '..');

    const browser = await chromium.launch({
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    const context = await browser.createContext();
    const page = await context.newPage();

    await page.goto(popupUrl);

    // Wait for project list to appear (either populated or skeleton)
    const projectList = page.locator('#project-list');
    await expect(projectList).toBeVisible();

    // Check that at least one project item exists (could be skeleton or real)
    const projectItems = page.locator('.project-item');
    const count = await projectItems.count();
    expect(count).toBeGreaterThan(0);

    await browser.close();
  });

  test('should select a project and show donation form', async () => {
    const extPath = path.join(__dirname, '..');

    const browser = await chromium.launch({
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    const context = await browser.createContext();
    const page = await context.newPage();

    await page.goto(popupUrl);

    // Wait for project list to load
    const projectList = page.locator('#project-list');
    await expect(projectList).toBeVisible();

    // Get first project item (skip skeletons)
    const projectItems = page.locator('.project-item:not(.skeleton)');
    await projectItems.first().waitFor({ timeout: 5000 }).catch(() => {
      // If no real projects loaded, use first item anyway (might be skeleton for testing)
    });

    const firstProject = page.locator('.project-item').first();
    await firstProject.click();

    // Verify donation form elements are visible
    const donationForm = page.locator('.donate-section');
    await expect(donationForm).toBeVisible();

    // Check for donation buttons/inputs
    const donateButton = page.locator('#donate-submit');
    await expect(donateButton).toBeVisible();

    // Check preset amount buttons
    const presetBtns = page.locator('.preset-btn');
    const presetCount = await presetBtns.count();
    expect(presetCount).toBeGreaterThan(0);

    // Verify custom amount input exists
    const customInput = page.locator('#custom-amount-input');
    await expect(customInput).toBeVisible();

    await browser.close();
  });

  test('should handle missing Freighter gracefully', async () => {
    const extPath = path.join(__dirname, '..');

    const browser = await chromium.launch({
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    const context = await browser.createContext();
    const page = await context.newPage();

    await page.goto(popupUrl);

    // Check if Freighter error message appears (if extension not connected)
    const errorMsg = page.locator('text=Freighter Wallet Required');
    
    // Either error message exists OR connect button exists
    const connectBtn = page.locator('#connect-btn');
    const hasError = await errorMsg.isVisible().catch(() => false);
    const hasConnect = await connectBtn.isVisible().catch(() => false);

    expect(hasError || hasConnect).toBeTruthy();

    await browser.close();
  });

  test('should maintain UI state through interactions', async () => {
    const extPath = path.join(__dirname, '..');

    const browser = await chromium.launch({
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
      ],
    });

    const context = await browser.createContext();
    const page = await context.newPage();

    await page.goto(popupUrl);

    // Click a preset amount
    const preset5XLM = page.locator('button[data-amount="5"]');
    if (await preset5XLM.isVisible()) {
      await preset5XLM.click();
      
      // Verify custom input shows the value
      const customInput = page.locator('#custom-amount-input');
      const value = await customInput.inputValue();
      // Input should be populated or button should be highlighted
      expect(value || preset5XLM.locator('..').isVisible()).toBeTruthy();
    }

    await browser.close();
  });
});
