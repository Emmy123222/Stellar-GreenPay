import { chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const extensionPath = path.resolve(__dirname, '..');

export async function launchExtension(profile?: string): Promise<BrowserContext> {
  if (!fs.existsSync(path.join(extensionPath, 'dist', 'background.js'))) {
    throw new Error('Extension not built. Run "npm run build" first.');
  }
  return chromium.launchPersistentContext(profile || '', {
    headless: !!process.env.CI,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const worker = context.serviceWorkers()[0];
    const id = worker?.url().match(/^chrome-extension:\/\/([a-p]+)\//)?.[1];
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Extension service worker did not start.');
}

export async function extensionPage(context: BrowserContext, page: Page, resource: string): Promise<void> {
  const id = await getExtensionId(context);
  await page.goto(`chrome-extension://${id}/${resource}`, { waitUntil: 'domcontentloaded' });
}

export function tempProfile(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'greenpay-extension-e2e-'));
}
