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

export function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      resolve({ ...DEFAULT_SETTINGS });
      return;
    }

    chrome.storage.sync.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>, (items: Record<string, unknown>) => {
      if (chrome.runtime?.lastError || !items) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }

      const loaded = { ...DEFAULT_SETTINGS, ...items } as ExtensionSettings;
      if (!Array.isArray(loaded.allowlist)) {
        loaded.allowlist = [...DEFAULT_SETTINGS.allowlist];
      }
      resolve(loaded);
    });
  });
}

export function saveSettings(settings: ExtensionSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      resolve();
      return;
    }

    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
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
