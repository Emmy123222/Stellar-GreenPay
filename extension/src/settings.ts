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

export function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      resolve(items as ExtensionSettings);
    });
  });
}

export function saveSettings(settings: ExtensionSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
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
