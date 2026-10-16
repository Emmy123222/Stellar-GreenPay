import { test, expect } from '@playwright/test';
import { extensionPage, launchExtension, tempProfile } from './extension-helpers';

test('pending transactions persist and expired entries recover after restart', async () => {
  const profile = tempProfile();
  const pending = {
    hash: 'a'.repeat(64),
    amount: '5',
    destination: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    createdAt: Date.now() - 6 * 60 * 1000,
  };

  const first = await launchExtension(profile);
  const firstPage = await first.newPage();
  await extensionPage(first, firstPage, 'settings.html');
  await firstPage.evaluate(async (value) => chrome.storage.local.set({ pendingDonations: [value] }), pending);
  await expect.poll(() => firstPage.evaluate(async () => {
    const stored = await chrome.storage.local.get('pendingDonations');
    return stored.pendingDonations?.length || 0;
  })).toBe(1);
  await first.close();

  const restarted = await launchExtension(profile);
  const page = await restarted.newPage();
  try {
    await extensionPage(restarted, page, 'settings.html');
    await expect.poll(() => page.evaluate(async () => {
      const stored = await chrome.storage.local.get('pendingDonations');
      return stored.pendingDonations?.length || 0;
    })).toBe(0);
  } finally {
    await restarted.close();
  }
});
