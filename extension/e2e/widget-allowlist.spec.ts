import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-helpers';

const stellarAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

test('content script injects only on allowlisted sites and reveals project context menu', async () => {
  const context = await launchExtension();
  try {
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(async () => chrome.storage.sync.set({ allowlist: ['allowed.test/*'] }));
    const page = await context.newPage();
    await page.route('https://allowed.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><main><p>${stellarAddress}</p></main></body></html>`,
    }));
    await page.goto('https://allowed.test/projects/demo', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.greenpay-address')).toContainText(stellarAddress);

    const menu = await worker.evaluate(async () => chrome.contextMenus.getAll());
    expect(menu).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'donate-project', visible: true }),
    ]));

    const denied = await context.newPage();
    await denied.route('https://denied.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><p>${stellarAddress}</p></body></html>`,
    }));
    await denied.goto('https://denied.test/', { waitUntil: 'domcontentloaded' });
    await expect(denied.locator('.greenpay-address')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
