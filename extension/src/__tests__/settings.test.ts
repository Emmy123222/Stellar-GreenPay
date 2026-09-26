/**
 * Tests for src/settings.ts
 *
 * `chrome.storage` is mocked with two in-memory areas that mirror the browser
 * semantics we rely on:
 *
 *   - `storage.sync`  is account-scoped and therefore shared between Chrome
 *                      profiles (this is what makes settings follow the user).
 *   - `storage.local` is profile-scoped and is only used as a fallback.
 *
 * A "second profile" is simulated by swapping in a fresh, empty local area
 * while keeping the same sync area.
 */

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  isQuotaExceededError,
  loadSettings,
  saveSettings,
} from '../settings';

type StorageChange = Record<string, unknown>;

let lastError: { message: string } | undefined;

/**
 * Builds an in-memory `chrome.storage.StorageArea` mock. Callbacks are invoked
 * synchronously, and `chrome.runtime.lastError` is set for the duration of the
 * callback so the code under test can read it exactly like the real API.
 */
function createStorageArea() {
  const store: StorageChange = {};
  let nextReadError: string | null = null;
  let nextWriteError: string | null = null;

  return {
    store,
    failNextRead(message: string) {
      nextReadError = message;
    },
    failNextWrite(message: string) {
      nextWriteError = message;
    },
    get: jest.fn(
      (
        keys: string | string[] | Record<string, unknown>,
        callback: (items: Record<string, unknown>) => void,
      ) => {
        const result: Record<string, unknown> = {};
        if (Array.isArray(keys)) {
          for (const key of keys) if (key in store) result[key] = store[key];
        } else if (typeof keys === 'string') {
          if (keys in store) result[keys] = store[keys];
        } else {
          for (const [key, fallback] of Object.entries(keys)) {
            result[key] = key in store ? store[key] : fallback;
          }
        }

        lastError = nextReadError ? { message: nextReadError } : undefined;
        nextReadError = null;
        callback(result);
        lastError = undefined;
      },
    ),
    set: jest.fn((items: Record<string, unknown>, callback: () => void) => {
      const error = nextWriteError;
      nextWriteError = null;
      if (!error) Object.assign(store, items);
      lastError = error ? { message: error } : undefined;
      callback();
      lastError = undefined;
    }),
    remove: jest.fn((keys: string | string[], callback: () => void) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete store[key];
      lastError = undefined;
      callback();
    }),
  };
}

type StorageAreaMock = ReturnType<typeof createStorageArea>;

let syncArea: StorageAreaMock;
let localArea: StorageAreaMock;

const runtime = {
  get lastError() {
    return lastError;
  },
};

function installChrome() {
  syncArea = createStorageArea();
  localArea = createStorageArea();
  (globalThis as { chrome?: unknown }).chrome = {
    storage: { sync: syncArea, local: localArea },
    runtime,
  };
}

/** Simulates opening the extension in a different Chrome profile. */
function simulateSecondProfile() {
  localArea = createStorageArea();
  (globalThis as { chrome?: any }).chrome.storage.local = localArea;
}

const SETTINGS = {
  backendUrl: 'https://api.example.org',
  network: 'mainnet' as const,
  defaultDonationAmount: '42',
};

beforeEach(() => {
  installChrome();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

describe('loadSettings()', () => {
  test('returns defaults when nothing has been stored', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  test('returns values previously persisted to sync storage', async () => {
    Object.assign(syncArea.store, SETTINGS);
    await expect(loadSettings()).resolves.toEqual(SETTINGS);
  });

  test('keeps reading settings that legacy installs stored locally', async () => {
    Object.assign(localArea.store, SETTINGS);
    await expect(loadSettings()).resolves.toEqual(SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// Cross-profile sync (acceptance criterion)
// ---------------------------------------------------------------------------

describe('saveSettings() cross-profile sync', () => {
  test('writes settings to chrome.storage.sync', async () => {
    await saveSettings(SETTINGS);

    expect(syncArea.set).toHaveBeenCalledWith(SETTINGS, expect.any(Function));
    expect(syncArea.store).toEqual(SETTINGS);
  });

  test('a setting written to sync is readable from a second simulated profile', async () => {
    await saveSettings(SETTINGS);

    // Second profile has its own empty local area but shares account sync.
    simulateSecondProfile();
    expect(localArea.store).toEqual({});

    await expect(loadSettings()).resolves.toEqual(SETTINGS);
  });

  test('a successful sync save clears any local fallback so it cannot shadow sync', async () => {
    Object.assign(localArea.store, { defaultDonationAmount: '99' });

    await saveSettings(SETTINGS);

    expect(localArea.remove).toHaveBeenCalledWith(SETTINGS_KEYS, expect.any(Function));
    expect(localArea.store).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Quota handling (acceptance criterion)
// ---------------------------------------------------------------------------

describe('isQuotaExceededError()', () => {
  test('detects byte and write-rate quota messages', () => {
    expect(isQuotaExceededError('QUOTA_BYTES quota exceeded')).toBe(true);
    expect(isQuotaExceededError('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded')).toBe(true);
    expect(isQuotaExceededError('MAX_SUSTAINED_WRITE_OPERATIONS_PER_HOUR quota exceeded')).toBe(true);
  });

  test('ignores empty or unrelated errors', () => {
    expect(isQuotaExceededError(undefined)).toBe(false);
    expect(isQuotaExceededError('Storage is unavailable')).toBe(false);
  });
});

describe('saveSettings() quota fallback', () => {
  test('falls back to local storage with a console warning when sync quota is exceeded', async () => {
    syncArea.failNextWrite('QUOTA_BYTES quota exceeded');

    await expect(saveSettings(SETTINGS)).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'));
    expect(localArea.set).toHaveBeenCalledWith(SETTINGS, expect.any(Function));
    expect(localArea.store).toEqual(SETTINGS);
    expect(syncArea.store).toEqual({});
  });

  test('settings saved through the fallback remain readable from local storage', async () => {
    syncArea.failNextWrite('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');

    await saveSettings(SETTINGS);

    await expect(loadSettings()).resolves.toEqual(SETTINGS);
  });

  test('rejects non-quota sync errors without touching local storage', async () => {
    syncArea.failNextWrite('Storage is unavailable');

    await expect(saveSettings(SETTINGS)).rejects.toThrow('Storage is unavailable');

    expect(localArea.set).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Read fallback
// ---------------------------------------------------------------------------

describe('loadSettings() read fallback', () => {
  test('falls back to local storage with a warning when sync cannot be read', async () => {
    Object.assign(localArea.store, SETTINGS);
    syncArea.failNextRead('Sync storage is disabled');

    await expect(loadSettings()).resolves.toEqual(SETTINGS);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('sync read failed'));
  });
});
