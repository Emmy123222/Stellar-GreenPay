import { test, expect } from '@playwright/test';
import { extensionPage, launchExtension } from './extension-helpers';

test('settings validates, adds, removes, and persists allowed sites', async () => {
  const context = await launchExtension();
  const page = await context.newPage();
  try {
    await extensionPage(context, page, 'settings.html');
    const input = page.locator('#new-allowlist-item');
    await input.fill('https://bad host');
    await page.locator('#add-allowlist-btn').click();
    await expect(page.locator('#allowlist-error')).toContainText('valid host pattern');
    await expect(page.locator('.allowlist-item-text', { hasText: 'https://bad host' })).toHaveCount(0);

    await input.fill('example.test/projects/*');
    await page.locator('#add-allowlist-btn').click();
    await expect(page.locator('.allowlist-item-text', { hasText: 'example.test/projects/*' })).toBeVisible();
    await page.locator('button[aria-label="Remove example.test/projects/*"]').click();
    await expect(page.locator('.allowlist-item-text', { hasText: 'example.test/projects/*' })).toHaveCount(0);

    await input.fill('allowed.test/*');
    await page.locator('#add-allowlist-btn').click();
    await page.locator('#settings-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator('#save-status')).toContainText('Settings saved.');
    const worker = context.serviceWorkers()[0];
    const saved = await worker.evaluate(async () => chrome.storage.sync.get('allowlist'));
    expect(saved.allowlist).toContain('allowed.test/*');
  } finally {
    await context.close();
  }
});
