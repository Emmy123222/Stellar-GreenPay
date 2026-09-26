export interface ExtensionSettings {
  backendUrl: string;
  network: 'testnet' | 'mainnet';
  defaultDonationAmount: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendUrl: 'https://api.stellar-greenpay.app',
  network: 'testnet',
  defaultDonationAmount: '5',
};

export const SETTINGS_KEYS: (keyof ExtensionSettings)[] = [
  'backendUrl',
  'network',
  'defaultDonationAmount',
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
    chrome.storage.local.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (items: Record<string, unknown>) => {
        resolve(items as unknown as ExtensionSettings);
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
    chrome.storage.sync.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (items: Record<string, unknown>) => {
        const syncError = chrome.runtime.lastError;
        if (syncError) {
          console.warn(
            `[GreenPay] chrome.storage.sync read failed (${syncError.message}); falling back to local storage.`,
          );
          void readSettingsFromLocal().then(resolve);
          return;
        }

        // A successful sync write clears the local fallback, so any keys still
        // present locally are the result of a sync write that hit quota. Prefer
        // those values so the newest settings win.
        chrome.storage.local.get(SETTINGS_KEYS, (localItems: Record<string, unknown>) => {
          resolve({
            ...(items as unknown as ExtensionSettings),
            ...(localItems as Partial<ExtensionSettings>),
          });
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
    chrome.storage.sync.set(settings, () => {
      const syncError = chrome.runtime.lastError;
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
          const localError = chrome.runtime.lastError;
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

// --- Wallet helpers ---

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

async function getWalletPublicKey(): Promise<string | null> {
  const freighter = (window as any).freighter;
  if (!freighter || typeof freighter.getPublicKey !== 'function') return null;
  try {
    return await freighter.getPublicKey() as string;
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

document.addEventListener('DOMContentLoaded', async () => {
  const backBtn = document.getElementById('back-btn') as HTMLButtonElement;
  const form = document.getElementById('settings-form') as HTMLFormElement;
  const urlInput = document.getElementById('backend-url') as HTMLInputElement;
  const urlError = document.getElementById('url-error') as HTMLSpanElement;
  const amountInput = document.getElementById('default-amount') as HTMLInputElement;
  const btnTestnet = document.getElementById('btn-testnet') as HTMLButtonElement;
  const btnMainnet = document.getElementById('btn-mainnet') as HTMLButtonElement;
  const mainnetWarning = document.getElementById('mainnet-warning') as HTMLSpanElement;
  const saveStatus = document.getElementById('save-status') as HTMLDivElement;
  const walletAddressText = document.getElementById('wallet-address-text') as HTMLSpanElement;
  const walletDot = document.getElementById('wallet-dot') as HTMLSpanElement;
  const walletActionBtn = document.getElementById('wallet-action-btn') as HTMLButtonElement;

  let selectedNetwork: 'testnet' | 'mainnet' = 'testnet';
  let walletConnected = false;

  function setActiveNetwork(network: 'testnet' | 'mainnet') {
    selectedNetwork = network;
    btnTestnet.classList.toggle('network-btn-active', network === 'testnet');
    btnMainnet.classList.toggle('network-btn-active', network === 'mainnet');
    mainnetWarning.classList.toggle('hidden', network !== 'mainnet');
  }

  function updateWalletUI(connected: boolean, publicKey: string | null = null) {
    walletConnected = connected;
    if (connected && publicKey) {
      walletAddressText.textContent = truncateAddress(publicKey);
      walletDot.className = 'dot online';
      walletActionBtn.textContent = 'Disconnect';
    } else {
      walletAddressText.textContent = 'Not connected';
      walletDot.className = 'dot';
      walletActionBtn.textContent = 'Connect Wallet';
    }
  }

  // Load saved settings
  const settings = await loadSettings();
  urlInput.value = settings.backendUrl;
  amountInput.value = settings.defaultDonationAmount;
  setActiveNetwork(settings.network);

  // Check wallet connection
  const connected = await isFreighterConnected();
  if (connected) {
    const publicKey = await getWalletPublicKey();
    updateWalletUI(true, publicKey);
  } else {
    updateWalletUI(false);
  }

  backBtn.addEventListener('click', () => {
    window.location.href = 'popup.html';
  });

  btnTestnet.addEventListener('click', () => setActiveNetwork('testnet'));
  btnMainnet.addEventListener('click', () => setActiveNetwork('mainnet'));

  walletActionBtn.addEventListener('click', async () => {
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    urlError.classList.add('hidden');
    saveStatus.textContent = '';
    saveStatus.className = 'status-message';

    const rawUrl = urlInput.value.trim();
    try {
      new URL(rawUrl);
    } catch {
      urlError.classList.remove('hidden');
      return;
    }

    const defaultAmount = amountInput.value.trim();
    const amount = defaultAmount && parseFloat(defaultAmount) > 0 ? defaultAmount : '5';

    try {
      await saveSettings({
        backendUrl: rawUrl,
        network: selectedNetwork,
        defaultDonationAmount: amount,
      });
      saveStatus.textContent = 'Settings saved.';
      saveStatus.classList.add('success');
    } catch (err: any) {
      saveStatus.textContent = `Failed to save: ${err.message}`;
      saveStatus.classList.add('error');
    }
  });
});
