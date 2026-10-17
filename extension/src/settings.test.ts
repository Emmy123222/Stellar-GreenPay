/**
 * Tests for allowlist validation and normalization in the settings page.
 */

import { addSiteToAllowlist, loadSettings } from './settings';

const SETTINGS_DOM = `
  <form id="settings-form">
    <input id="backend-url" />
    <span id="url-error" class="hidden"></span>
    <input id="default-amount" />
    <button type="button" id="btn-testnet"></button>
    <button type="button" id="btn-mainnet"></button>
    <span id="mainnet-warning" class="hidden"></span>
    <div id="save-status"></div>
    <span id="wallet-address-text"></span>
    <span id="wallet-dot"></span>
    <button type="button" id="wallet-action-btn"></button>
    <input id="new-allowlist-item" />
    <button type="button" id="add-allowlist-btn"></button>
    <span id="allowlist-error" class="hidden"></span>
    <ul id="allowlist-items"></ul>
  </form>
`;

function installChromeMock(): void {
  const store: Record<string, unknown> = { allowlist: [] };

  const get = jest.fn(
    (
      keys: string | string[] | Record<string, unknown>,
      callback?: (result: Record<string, unknown>) => void,
    ) => {
      let result: Record<string, unknown> = {};
      if (typeof keys === 'string') {
        result = { [keys]: store[keys] };
      } else if (Array.isArray(keys)) {
        result = Object.fromEntries(keys.map((key) => [key, store[key]]));
      } else {
        result = Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [
            key,
            store[key] === undefined ? fallback : store[key],
          ]),
        );
      }
      callback?.(result);
    },
  );

  const set = jest.fn(
    (items: Record<string, unknown>, callback?: () => void) => {
      Object.assign(store, items);
      callback?.();
    },
  );

  (globalThis as any).chrome = {
    storage: { sync: { get, set }, local: { get, set } },
    runtime: {},
  };
}

async function loadSettingsPage(): Promise<void> {
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function addPattern(pattern: string): void {
  const input = document.getElementById('new-allowlist-item') as HTMLInputElement;
  input.value = pattern;
  document
    .getElementById('add-allowlist-btn')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = SETTINGS_DOM;
  installChromeMock();
  delete (window as any).freighter;
});

describe('Settings allowlist validation', () => {
  test('rejects a malformed pattern with a visible message', async () => {
    await loadSettingsPage();
    addPattern('htp:/example');

    const error = document.getElementById('allowlist-error')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('valid host pattern');
    expect(document.querySelectorAll('.allowlist-item')).toHaveLength(0);
  });

  test('normalizes an uppercase host and trailing slash before adding', async () => {
    await loadSettingsPage();
    addPattern('  Example.COM/  ');

    const error = document.getElementById('allowlist-error')!;
    expect(error.classList.contains('hidden')).toBe(true);
    expect(
      document.querySelector('.allowlist-item-text')?.textContent,
    ).toBe('example.com/*');
  });

  test('reports a duplicate after normalization', async () => {
    await loadSettingsPage();
    addPattern('example.com/*');
    addPattern('Example.com');

    const error = document.getElementById('allowlist-error')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('already in allowlist');
    expect(document.querySelectorAll('.allowlist-item')).toHaveLength(1);
  });
});

describe('settings storage helpers', () => {
  test('addSiteToAllowlist normalizes valid patterns and ignores invalid ones', async () => {
    await loadSettingsPage();

    await expect(addSiteToAllowlist('Example.COM/')).resolves.toEqual([
      'example.com/*',
    ]);
    await expect(addSiteToAllowlist('htp:/example')).resolves.toEqual([
      'example.com/*',
    ]);

    const settings = await loadSettings();
    expect(settings.allowlist).toEqual(['example.com/*']);
  });
});
