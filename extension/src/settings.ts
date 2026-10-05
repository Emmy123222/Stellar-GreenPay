import { DEFAULT_ALLOWLIST, isUrlAllowed } from './allowlist';

export interface ExtensionSettings {
  backendUrl: string;
  network: 'testnet' | 'mainnet';
  defaultDonationAmount: string;
  allowlist: string[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendUrl: 'https://api.stellar-greenpay.app',
  network: 'testnet',
  defaultDonationAmount: '5',
  allowlist: [...DEFAULT_ALLOWLIST],
};

export const SETTINGS_KEYS: (keyof ExtensionSettings)[] = [
  'backendUrl',
  'network',
  'defaultDonationAmount',
  'allowlist',
];

/**
 * Returns true when a `chrome.runtime.lastError` message indicates that the
 * `chrome.storage.sync` quota has been exceeded (per-item bytes, total bytes,
 * or write-operation rate limits).
 */
export function isQuotaExceededError(message?: string): boolean {
  if (!message) return false;
  return /quota|MAX_WRITE_OPERATIONS|MAX_SUSTAINED_WRITE_OPERATIONS/i.test(message);
}

function readSettingsFromLocal(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve({ ...DEFAULT_SETTINGS, allowlist: [...DEFAULT_SETTINGS.allowlist] });
      return;
    }
    chrome.storage.local.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (items: Record<string, unknown>) => {
        const loaded = { ...DEFAULT_SETTINGS, ...(items as Partial<ExtensionSettings>) } as ExtensionSettings;
        if (!Array.isArray(loaded.allowlist)) {
          loaded.allowlist = [...DEFAULT_SETTINGS.allowlist];
        }
        resolve(loaded);
      },
    );
  });
}

/**
 * Reads settings from `chrome.storage.sync` so they follow the user across
 * signed-in Chrome profiles. If the sync area cannot be read, or if a previous
 * save fell back to local storage because the sync quota was exceeded, the
 * local copy is used instead.
 */
export function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
      resolve({ ...DEFAULT_SETTINGS, allowlist: [...DEFAULT_SETTINGS.allowlist] });
      return;
    }
    chrome.storage.sync.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (items: Record<string, unknown>) => {
        const syncError = chrome.runtime?.lastError;
        if (syncError || !items) {
          console.warn(
            `[GreenPay] chrome.storage.sync read failed (${syncError?.message ?? 'unknown error'}); falling back to local storage.`,
          );
          void readSettingsFromLocal().then(resolve);
          return;
        }

        // A successful sync write clears the local fallback, so any keys still
        // present locally are the result of a sync write that hit quota. Prefer
        // those values so the newest settings win.
        chrome.storage.local.get(SETTINGS_KEYS, (localItems: Record<string, unknown>) => {
          const merged = {
            ...DEFAULT_SETTINGS,
            ...(items as Partial<ExtensionSettings>),
            ...(localItems as Partial<ExtensionSettings>),
          } as ExtensionSettings;
          if (!Array.isArray(merged.allowlist)) {
            merged.allowlist = [...DEFAULT_SETTINGS.allowlist];
          }
          resolve(merged);
        });
      },
    );
  });
}

/**
 * Persists settings to `chrome.storage.sync`. When the sync quota is exceeded
 * the write falls back to `chrome.storage.local` (with a console warning) so
 * the user's settings are still saved — they just won't sync across profiles.
 */
export function saveSettings(settings: ExtensionSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      resolve();
      return;
    }

    chrome.storage.sync.set(settings, () => {
      const syncError = chrome.runtime?.lastError;
      if (!syncError) {
        // Sync succeeded — drop any stale local fallback so it can't shadow the
        // freshly synced values on the next load.
        chrome.storage.local.remove(SETTINGS_KEYS, () => resolve());
        return;
      }

      if (isQuotaExceededError(syncError.message)) {
        console.warn(
          `[GreenPay] chrome.storage.sync quota exceeded (${syncError.message}); falling back to local storage. Settings will not sync across profiles until the quota frees up.`,
        );
        chrome.storage.local.set(settings, () => {
          const localError = chrome.runtime?.lastError;
          if (localError) {
            reject(new Error(localError.message));
          } else {
            resolve();
          }
        });
        return;
      }

      reject(new Error(syncError.message));
    });
  });
}

export async function addSiteToAllowlist(pattern: string): Promise<string[]> {
  const settings = await loadSettings();
  const trimmed = pattern.trim().toLowerCase();
  if (!trimmed) return settings.allowlist;

  if (!settings.allowlist.some((entry) => entry.toLowerCase() === trimmed)) {
    const updated = [...settings.allowlist, trimmed];
    await saveSettings({ ...settings, allowlist: updated });
    return updated;
  }
  return settings.allowlist;
}

export async function removeSiteFromAllowlist(patternOrHost: string): Promise<string[]> {
  const settings = await loadSettings();
  const target = patternOrHost.trim().toLowerCase();
  if (!target) return settings.allowlist;

  const updated = settings.allowlist.filter((entry) => {
    const entryLower = entry.toLowerCase();
    return (
      entryLower !== target &&
      entryLower !== `${target}/*` &&
      entryLower !== `https://${target}/*` &&
      entryLower !== `http://${target}/*` &&
      entryLower !== `*://${target}/*`
    );
  });

  await saveSettings({ ...settings, allowlist: updated });
  return updated;
}

export async function isSiteAllowlisted(urlStr: string): Promise<boolean> {
  const settings = await loadSettings();
  return isUrlAllowed(urlStr, settings.allowlist);
}

// --- Wallet helpers ---

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

async function getWalletPublicKey(): Promise<string | null> {
  const freighter = (window as any).freighter;
  if (!freighter || typeof freighter.getPublicKey !== 'function') return null;
  try {
    return (await freighter.getPublicKey()) as string;
  } catch {
    return null;
  }
}

async function isFreighterConnected(): Promise<boolean> {
  const freighter = (window as any).freighter;
  if (!freighter || typeof freighter.isConnected !== 'function') return false;
  try {
    const result = await freighter.isConnected();
    return result === true || result?.isConnected === true;
  } catch {
    return false;
  }
}

async function freighterDisconnect(): Promise<void> {
  const freighter = (window as any).freighter;
  if (freighter && typeof freighter.disconnect === 'function') {
    try {
      await freighter.disconnect();
    } catch {
      // Silently ignore
    }
  }
}

// --- Settings page UI ---

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    const backBtn = document.getElementById('back-btn') as HTMLButtonElement | null;
    const form = document.getElementById('settings-form') as HTMLFormElement | null;
    const urlInput = document.getElementById('backend-url') as HTMLInputElement | null;
    const urlError = document.getElementById('url-error') as HTMLSpanElement | null;
    const amountInput = document.getElementById('default-amount') as HTMLInputElement | null;
    const btnTestnet = document.getElementById('btn-testnet') as HTMLButtonElement | null;
    const btnMainnet = document.getElementById('btn-mainnet') as HTMLButtonElement | null;
    const mainnetWarning = document.getElementById('mainnet-warning') as HTMLSpanElement | null;
    const saveStatus = document.getElementById('save-status') as HTMLDivElement | null;
    const walletAddressText = document.getElementById('wallet-address-text') as HTMLSpanElement | null;
    const walletDot = document.getElementById('wallet-dot') as HTMLSpanElement | null;
    const walletActionBtn = document.getElementById('wallet-action-btn') as HTMLButtonElement | null;

    // Allowlist elements
    const allowlistInput = document.getElementById('new-allowlist-item') as HTMLInputElement | null;
    const addAllowlistBtn = document.getElementById('add-allowlist-btn') as HTMLButtonElement | null;
    const allowlistError = document.getElementById('allowlist-error') as HTMLSpanElement | null;
    const allowlistItemsList = document.getElementById('allowlist-items') as HTMLUListElement | null;

    if (!form || !urlInput) return;

    let selectedNetwork: 'testnet' | 'mainnet' = 'testnet';
    let walletConnected = false;
    let currentAllowlist: string[] = [];

    function renderAllowlist() {
      if (!allowlistItemsList) return;
      allowlistItemsList.innerHTML = '';

      if (currentAllowlist.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'allowlist-empty';
        emptyLi.textContent = 'No sites allowlisted. Widget is disabled on all external sites.';
        allowlistItemsList.appendChild(emptyLi);
        return;
      }

      currentAllowlist.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'allowlist-item';

        const span = document.createElement('span');
        span.className = 'allowlist-item-text';
        span.textContent = item;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'allowlist-remove-btn';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Remove site';
        delBtn.setAttribute('aria-label', `Remove ${item}`);
        delBtn.addEventListener('click', () => {
          currentAllowlist.splice(index, 1);
          renderAllowlist();
        });

        li.appendChild(span);
        li.appendChild(delBtn);
        allowlistItemsList.appendChild(li);
      });
    }

    function setActiveNetwork(network: 'testnet' | 'mainnet') {
      selectedNetwork = network;
      btnTestnet?.classList.toggle('network-btn-active', network === 'testnet');
      btnMainnet?.classList.toggle('network-btn-active', network === 'mainnet');
      mainnetWarning?.classList.toggle('hidden', network !== 'mainnet');
    }

    function updateWalletUI(connected: boolean, publicKey: string | null = null) {
      walletConnected = connected;
      if (connected && publicKey) {
        if (walletAddressText) walletAddressText.textContent = truncateAddress(publicKey);
        if (walletDot) walletDot.className = 'dot online';
        if (walletActionBtn) walletActionBtn.textContent = 'Disconnect';
      } else {
        if (walletAddressText) walletAddressText.textContent = 'Not connected';
        if (walletDot) walletDot.className = 'dot';
        if (walletActionBtn) walletActionBtn.textContent = 'Connect Wallet';
      }
    }

    // Load saved settings
    const settings = await loadSettings();
    urlInput.value = settings.backendUrl;
    if (amountInput) amountInput.value = settings.defaultDonationAmount;
    currentAllowlist = [...settings.allowlist];
    renderAllowlist();
    setActiveNetwork(settings.network);

    // Check wallet connection
    const connected = await isFreighterConnected();
    if (connected) {
      const publicKey = await getWalletPublicKey();
      updateWalletUI(true, publicKey);
    } else {
      updateWalletUI(false);
    }

    backBtn?.addEventListener('click', () => {
      window.location.href = 'popup.html';
    });

    btnTestnet?.addEventListener('click', () => setActiveNetwork('testnet'));
    btnMainnet?.addEventListener('click', () => setActiveNetwork('mainnet'));

    walletActionBtn?.addEventListener('click', async () => {
      if (walletConnected) {
        await freighterDisconnect();
        updateWalletUI(false);
      } else {
        const publicKey = await getWalletPublicKey();
        if (publicKey) {
          updateWalletUI(true, publicKey);
        }
      }
    });

    // Add allowlist item handler
    function handleAddSite() {
      if (!allowlistInput) return;
      allowlistError?.classList.add('hidden');
      const val = allowlistInput.value.trim().toLowerCase();
      if (!val) {
        if (allowlistError) {
          allowlistError.textContent = 'Please enter a site or pattern.';
          allowlistError.classList.remove('hidden');
        }
        return;
      }

      if (currentAllowlist.includes(val)) {
        if (allowlistError) {
          allowlistError.textContent = 'Site pattern is already in allowlist.';
          allowlistError.classList.remove('hidden');
        }
        return;
      }

      currentAllowlist.push(val);
      allowlistInput.value = '';
      renderAllowlist();
    }

    addAllowlistBtn?.addEventListener('click', handleAddSite);
    allowlistInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddSite();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      urlError?.classList.add('hidden');
      if (saveStatus) {
        saveStatus.textContent = '';
        saveStatus.className = 'status-message';
      }

      const rawUrl = urlInput.value.trim();
      try {
        new URL(rawUrl);
      } catch {
        urlError?.classList.remove('hidden');
        return;
      }

      const defaultAmount = amountInput?.value.trim() ?? '5';
      const amount = defaultAmount && parseFloat(defaultAmount) > 0 ? defaultAmount : '5';

      try {
        await saveSettings({
          backendUrl: rawUrl,
          network: selectedNetwork,
          defaultDonationAmount: amount,
          allowlist: currentAllowlist,
        });
        if (saveStatus) {
          saveStatus.textContent = 'Settings saved.';
          saveStatus.classList.add('success');
        }
      } catch (err: any) {
        if (saveStatus) {
          saveStatus.textContent = `Failed to save: ${err.message}`;
          saveStatus.classList.add('error');
        }
      }
    });
  });
}
