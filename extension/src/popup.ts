import {
  Asset,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { loadSettings, type ExtensionSettings } from './settings';

// Module-level vars
let API_BASE = 'https://api.stellar-greenpay.app';
let NETWORK_PASSPHRASE: string = Networks.TESTNET;
let horizonUrl = 'https://horizon-testnet.stellar.org';
let server = new Horizon.Server(horizonUrl);

function applySettings(settings: ExtensionSettings) {
  API_BASE = settings.backendUrl;
  if (settings.network === 'mainnet') {
    NETWORK_PASSPHRASE = Networks.PUBLIC;
    horizonUrl = 'https://horizon.stellar.org';
  } else {
    NETWORK_PASSPHRASE = Networks.TESTNET;
    horizonUrl = 'https://horizon-testnet.stellar.org';
  }
  server = new Horizon.Server(horizonUrl);
}

// ==================== BADGE HELPERS ====================
function abbreviateNumber(num: number): string {
  if (num < 1000) return Math.floor(num).toString();
  if (num < 1000000) return Math.floor(num / 1000) + 'K';
  return (num / 1000000).toFixed(1) + 'M';
}

async function updateDonationBadge(totalXLM: number) {
  const text = abbreviateNumber(totalXLM);
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    console.log(`[GreenPay Badge] Updated: ${text} (${totalXLM} XLM)`);
  } catch (e) {
    console.error('Badge update failed:', e);
  }
}

async function signWithFreighter(xdr: string): Promise<string> {
  const freighter = (window as any).freighter;
  if (!freighter) throw new Error('Freighter extension not found');

  const signedXdr: string = await freighter.signTransaction(xdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  return signedXdr;
}

async function submitTransaction(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const result = await server.submitTransaction(tx as any);
  return (result as any).hash;
}

// --- Project search autocomplete ---

interface ProjectResult {
  id: string;
  name: string;
  category: string;
  walletAddress?: string;
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeDropdownIndex = -1;
let dropdownItems: HTMLLIElement[] = [];
let selectedProjectId: string | null = null;

// --- Project list keyboard navigation ---

let projectListItems: HTMLLIElement[] = [];
let activeProjectListIndex = -1;

/**
 * Render a list of projects into the #project-list element and wire up
 * keyboard navigation (ArrowDown/Up, Enter, Escape).
 *
 * Keyboard contract (issue #489):
 *   ArrowDown  — move focus to the next project item
 *   ArrowUp    — move focus to the previous project item
 *   Enter      — open the focused project in a new tab or trigger donation
 *   Escape     — close the popup window
 */
function renderProjectList(projects: ProjectResult[]) {
  const list = document.getElementById('project-list') as HTMLUListElement | null;
  if (!list) return;

  list.innerHTML = '';
  projectListItems = [];
  activeProjectListIndex = -1;

  if (projects.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'glass-panel project-item';
    empty.textContent = 'No saved projects yet.';
    list.appendChild(empty);
    return;
  }

  projects.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'glass-panel project-item';
    li.setAttribute('tabindex', '0');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-label', `${escapeHtml(p.name)}, ${escapeHtml(p.category)}`);
    li.innerHTML = `
      <div class="project-avatar" aria-hidden="true">
        <span style="font-size:20px">${getProjectEmoji(p.category)}</span>
      </div>
      <div class="project-info">
        <div class="project-name">${escapeHtml(p.name)}</div>
        <div class="project-desc">${escapeHtml(p.category)}</div>
      </div>
    `;

    // Mouse click — select this project for donation
    li.addEventListener('click', () => {
      selectProjectListItem(li, p);
    });

    // Allow keyboard activation via Enter/Space
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectProjectListItem(li, p);
      }
    });

    list.appendChild(li);
    projectListItems.push(li);
  });

  // Update badge count
  const badge = document.querySelector('.section-header .badge');
  if (badge) badge.textContent = String(projects.length);
}

function selectProjectListItem(li: HTMLLIElement, p: ProjectResult) {
  // Highlight the selected item
  projectListItems.forEach((el) => el.classList.remove('active'));
  li.classList.add('active');

  // Pre-fill the destination address field
  const destInput = document.getElementById('destination') as HTMLInputElement | null;
  const searchInput = document.getElementById('project-search') as HTMLInputElement | null;
  if (p.walletAddress && destInput) {
    destInput.value = p.walletAddress;
    selectedProjectId = p.id;
  }
  if (searchInput) {
    searchInput.value = p.name;
  }
}

function highlightProjectListItem(index: number) {
  projectListItems.forEach((el, i) => {
    if (i === index) {
      el.classList.add('active');
      el.focus();
    } else {
      el.classList.remove('active');
    }
  });
}

/** Map a project category to a representative emoji. */
function getProjectEmoji(category: string): string {
  const map: Record<string, string> = {
    'Reforestation': '🌳',
    'Solar Energy': '☀️',
    'Ocean Conservation': '🌊',
    'Clean Water': '💧',
    'Wildlife Protection': '🦁',
    'Carbon Capture': '♻️',
    'Wind Energy': '💨',
    'Sustainable Agriculture': '🌾',
  };
  return map[category] ?? '🌿';
}

function initProjectListKeyNav() {
  const list = document.getElementById('project-list') as HTMLUListElement | null;
  if (!list) return;

  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Saved projects');

  list.addEventListener('keydown', (e) => {
    if (projectListItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeProjectListIndex = Math.min(
        activeProjectListIndex + 1,
        projectListItems.length - 1,
      );
      highlightProjectListItem(activeProjectListIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeProjectListIndex = Math.max(activeProjectListIndex - 1, 0);
      highlightProjectListItem(activeProjectListIndex);
    } else if (e.key === 'Enter' && activeProjectListIndex >= 0) {
      projectListItems[activeProjectListIndex]?.click();
    } else if (e.key === 'Escape') {
      window.close();
    }
  });
}

function debounce(fn: () => void, ms: number) {
  if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(fn, ms);
}

function renderDropdown(projects: ProjectResult[], dropdown: HTMLUListElement) {
  dropdown.innerHTML = '';
  dropdownItems = [];
  activeDropdownIndex = -1;

  if (projects.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'search-no-results';
    empty.textContent = 'No projects found';
    dropdown.appendChild(empty);
    dropdown.classList.remove('hidden');
    return;
  }

  projects.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div class="search-result-name">${escapeHtml(p.name)}</div>
        <div class="search-result-cat">${escapeHtml(p.category)}</div>
      </div>
    `;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const destInput = document.getElementById('destination') as HTMLInputElement | null;
      const searchInput = document.getElementById('project-search') as HTMLInputElement | null;
      if (p.walletAddress && destInput) {
        destInput.value = p.walletAddress;
        selectedProjectId = p.id;
      }
      if (searchInput) {
        searchInput.value = p.name;
      }
      dropdown.classList.add('hidden');
    });
  });
}

async function saveTotalDonated(total: number) {
  return new Promise<void>((resolve) => {
    chrome.storage.local.set({ totalDonatedXLM: Math.max(0, total) }, () => {
      updateDonationBadge(total);
      resolve();
    });
  });
}

async function updateTotalAfterDonation(amount: number) {
  chrome.storage.local.get(['totalDonatedXLM'], async (result) => {
    const current = (result.totalDonatedXLM as number) || 0;
    await saveTotalDonated(current + amount);
  });
}

// ==================== PROFILE API ====================
async function fetchProfile(publicKey: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(publicKey)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('Profile fetch failed (using local storage fallback):', e);
    return null;
  }
}

// ==================== WALLET CONNECT ====================
let currentPublicKey: string | null = null;

async function connectWallet() {
  try {
    const freighter = (window as any).freighter;
    if (!freighter) {
      alert('Please install the Freighter wallet extension.');
      return;
    }

    const publicKey = await freighter.getPublicKey();
    currentPublicKey = publicKey;

    // UI Updates
    const addressEl = document.getElementById('wallet-address') as HTMLSpanElement | null;
    if (addressEl) addressEl.textContent = `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}`;

    const walletInfo = document.getElementById('wallet-info') as HTMLElement | null;
    if (walletInfo) walletInfo.classList.remove('hidden');

    const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement | null;
    if (connectBtn) {
      connectBtn.textContent = '✓ Connected';
      connectBtn.disabled = true;
    }

    // Fetch total donated from backend
    const profile = await fetchProfile(publicKey);
    let total = 0;
    if (profile?.data?.totalDonatedXLM || profile?.totalDonatedXLM) {
      total = parseFloat(profile.data?.totalDonatedXLM || profile.totalDonatedXLM) || 0;
    }
    await saveTotalDonated(total);

  } catch (err: any) {
    console.error('Wallet connect error:', err);
    alert('Failed to connect wallet: ' + (err.message || 'Unknown error'));
  }
}

// ==================== DONATION HELPERS (keep your existing ones) ====================
// buildDonationTransaction, signWithFreighter, submitTransaction, recordDonation, etc.

// After successful donation in your submit handler, add:
// await updateTotalAfterDonation(parseFloat(amount));

// ==================== MAIN INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  applySettings(settings);

  // Pre-fill donation amount from saved default
  const amountInput = document.getElementById('custom-amount-input') as HTMLInputElement | null;
  if (amountInput && settings.defaultDonationAmount) {
    amountInput.value = settings.defaultDonationAmount;
  }

  // Wire settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      window.location.href = 'settings.html';
    });
  }

  initProjectSearch();
  initProjectListKeyNav();

  // Check for pending context-menu donation
  chrome.storage.local.get(['pendingDonationProjectId', 'pendingDonationAddress'], async (res) => {
    if (res.pendingDonationProjectId) {
      chrome.storage.local.remove('pendingDonationProjectId');
      try {
        const response = await fetch(`${API_BASE}/api/projects/${res.pendingDonationProjectId}`);
        if (response.ok) {
          const json = await response.json();
          const projectData = json.data;
          
          const destInput = document.getElementById('destination') as HTMLInputElement | null;
          const searchInput = document.getElementById('project-search') as HTMLInputElement | null;
          
          if (destInput && projectData.walletAddress) {
            destInput.value = projectData.walletAddress;
            selectedProjectId = projectData.id;
          }
          if (searchInput && projectData.name) {
            searchInput.value = projectData.name;
          }
        }
      } catch (err) {
        console.error('Failed to pre-fill project from context menu', err);
      }
    } else if (res.pendingDonationAddress) {
      chrome.storage.local.remove('pendingDonationAddress');
      const destInput = document.getElementById('destination') as HTMLInputElement | null;
      if (destInput) {
        destInput.value = res.pendingDonationAddress;
      }
    }
  });

  const form = document.getElementById('donation-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sourceAddress = ((document.getElementById('source-address') as HTMLInputElement)?.value ?? '').trim();
    const destination = ((document.getElementById('destination') as HTMLInputElement)?.value ?? '').trim();
    const amount = ((document.getElementById('amount') as HTMLInputElement)?.value ?? '').trim();
    const memo = ((document.getElementById('memo') as HTMLInputElement)?.value ?? '').trim();

    if (!sourceAddress || !destination || !amount) {
      setStatus('Please fill in all required fields.', true);
      return;
    }
  } catch {
    // Silently ignore — the skeleton loader remains visible
  }

  // Connect button
  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement | null;
  if (connectBtn) connectBtn.addEventListener('click', connectWallet);

  // Settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => window.location.href = 'settings.html');
  }

  console.log('🌿 GreenPay Extension initialized with donation badge (#490)');
});