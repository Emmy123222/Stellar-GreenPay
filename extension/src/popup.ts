import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  loadSettings,
  addSiteToAllowlist,
  removeSiteFromAllowlist,
  type ExtensionSettings,
} from './settings';
import { getHostnameFromUrl, isUrlAllowed } from './allowlist';
import {
  addPendingDonation,
  checkPendingDonations,
  getPendingDonations,
  horizonUrlForNetwork,
  PENDING_STORAGE_KEY,
  stellarExpertTxUrl,
  syncBadge,
  type PendingDonation,
} from './pendingTransactions';

// Module-level vars
let API_BASE = 'https://api.stellar-greenpay.app';
let NETWORK_PASSPHRASE: string = Networks.TESTNET;
let currentNetwork: 'testnet' | 'mainnet' = 'testnet';
let horizonUrl = 'https://horizon-testnet.stellar.org';
let server = new Horizon.Server(horizonUrl);

function applySettings(settings: ExtensionSettings) {
  API_BASE = settings.backendUrl;
  currentNetwork = settings.network === 'mainnet' ? 'mainnet' : 'testnet';
  if (currentNetwork === 'mainnet') {
    NETWORK_PASSPHRASE = Networks.PUBLIC;
  } else {
    NETWORK_PASSPHRASE = Networks.TESTNET;
  }
  horizonUrl = horizonUrlForNetwork(currentNetwork);
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
    const empty = document.createElement("li");
    empty.className = "glass-panel empty-state";
    empty.innerHTML = `
      <div class="empty-state-icon" aria-hidden="true">🌱</div>
      <div class="empty-state-content">
        <h4 class="empty-state-title">Start your climate journey</h4>
        <p class="empty-state-text">You haven't donated to any projects yet. Discover amazing climate initiatives and make your first donation!</p>
        <button class="btn empty-state-btn" id="find-project-btn">
          Find a project
        </button>
      </div>
    `;
    list.appendChild(empty);
    
    // Add event listener for the "Find a project" button
    const findProjectBtn = empty.querySelector("#find-project-btn");
    if (findProjectBtn) {
      findProjectBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: "https://stellar-greenpay.app/projects" });
      });
    }
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

  // Pre-fill the search field with the chosen project
  const searchInput = document.getElementById('project-search') as HTMLInputElement | null;
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

function escapeHtml(text: string): string {
  const span = document.createElement('span');
  span.textContent = text;
  return span.innerHTML;
}

function setStatus(message: string, isError = false) {
  const statusEl = document.getElementById('status-message') as HTMLElement | null;
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status-message${isError ? ' error' : ' success'}`;
}

function initDonationControls() {
  const amountInput = document.getElementById('custom-amount-input') as HTMLInputElement | null;
  const donateBtn = document.getElementById('donate-submit') as HTMLButtonElement | null;
  if (!amountInput || !donateBtn) return;

  const updateButtonState = () => {
    const amount = parseFloat(amountInput.value || '0');
    donateBtn.disabled = Number.isNaN(amount) || amount <= 0;
  };

  amountInput.addEventListener('input', updateButtonState);
  updateButtonState();

  donateBtn.addEventListener('click', async () => {
    const amount = parseFloat(amountInput.value || '0');
    if (Number.isNaN(amount) || amount <= 0) {
      setStatus('Enter a valid donation amount.', true);
      return;
    }

    setStatus('Processing donation...', false);
    try {
      await updateTotalAfterDonation(amount);
      setStatus(`Donation of ${amount.toFixed(2)} XLM recorded.`, false);
      amountInput.value = '';
      updateButtonState();
    } catch (err) {
      console.error('Donation error:', err);
      setStatus('Donation failed. Please try again.', true);
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

function debounce(fn: () => void | Promise<void>, ms: number) {
  if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => void fn(), ms);
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
    li.className = 'search-result-item';
    li.innerHTML = `
      <div>
        <div class="search-result-name">${escapeHtml(p.name)}</div>
        <div class="search-result-cat">${escapeHtml(p.category)}</div>
      </div>
    `;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const searchInput = document.getElementById('project-search') as HTMLInputElement | null;
      if (searchInput) {
        searchInput.value = p.name;
      }
      dropdown.classList.add('hidden');
    });

    dropdown.appendChild(li);
    dropdownItems.push(li);
  });

  dropdown.classList.remove('hidden');
}

// ==================== PENDING TRANSACTIONS ====================

async function renderPendingFromStorage() {
  renderPendingDonations(await getPendingDonations());
}

async function refreshPendingSection() {
  renderPendingDonations(await checkPendingDonations());
}

function truncateAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

function formatAge(createdAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function renderPendingDonations(donations: PendingDonation[]) {
  const section = document.getElementById("pending-section");
  const list = document.getElementById(
    "pending-list",
  ) as HTMLUListElement | null;
  const count = document.getElementById("pending-count");
  if (!section || !list || !count) return;

  list.innerHTML = "";
  count.textContent = String(donations.length);
  section.classList.toggle("hidden", donations.length === 0);

  donations.forEach((donation) => {
    const info = document.createElement("div");
    info.className = "pending-info";

    const amount = document.createElement("div");
    amount.className = "pending-amount";
    amount.textContent = `${donation.amount} XLM pending`;

    const recipient = document.createElement("div");
    recipient.className = "pending-dest";
    recipient.textContent = `to ${truncateAddress(donation.destination)} · ${formatAge(donation.createdAt)}`;

    info.append(amount, recipient);

    const link = document.createElement("a");
    link.className = "pending-link";
    link.href = stellarExpertTxUrl(donation.hash, currentNetwork);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Stellar Expert";

    const item = document.createElement("li");
    item.className = "glass-panel pending-item";
    item.append(info, link);
    list.appendChild(item);
  });
}

function initPendingSection() {
  void refreshPendingSection();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PENDING_STORAGE_KEY])
      void renderPendingFromStorage();
  });

  window.setInterval(() => void refreshPendingSection(), 15000);
}

async function saveTotalDonated(total: number) {
  return new Promise<void>((resolve) => {
    // syncBadge gives the pending red dot precedence while a donation is in
    // flight, and restores the donation total once everything has settled.
    chrome.storage.local.set(
      { totalDonatedXLM: Math.max(0, total) },
      async () => {
        await syncBadge();
        resolve();
      },
    );
  });
}

async function updateTotalAfterDonation(amount: number) {
  chrome.storage.local.get(
    ["totalDonatedXLM"],
    async (result: Record<string, unknown>) => {
      const current = (result.totalDonatedXLM as number) || 0;
      const total = current + amount;
      const badgeTier = total >= 2000
        ? "earth"
        : total >= 500
          ? "forest"
          : total >= 100
            ? "tree"
            : total >= 10
              ? "seedling"
              : null;
      await saveTotalDonated(total);
      renderDonorStats(total, badgeTier);
    },
  );
}

function renderDonorStats(totalXLM: number, badgeTier: string | null) {
  const totalElement = document.getElementById("donor-total");
  const tierElement = document.getElementById("donor-badge-tier");
  const tierLabels: Record<string, string> = {
    seedling: "Seedling",
    tree: "Tree",
    forest: "Forest",
    earth: "Earth",
  };

  if (totalElement) {
    totalElement.textContent = `${totalXLM.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`;
  }
  if (tierElement) {
    tierElement.textContent = badgeTier ? tierLabels[badgeTier] || badgeTier : "No badge";
  }
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

/** Key used to cache the connected address in `chrome.storage.session`. */
const SESSION_ADDRESS_KEY = 'connectedWalletAddress';

/**
 * Session storage is in-memory and dropped when the browser closes, so the
 * cached address never outlives the browsing session. Browsers without
 * `storage.session` (older Firefox) fall back to no caching.
 */
const sessionArea = (): chrome.storage.StorageArea | null =>
  chrome.storage?.session ?? null;

function getSessionAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const area = sessionArea();
    if (!area) {
      resolve(null);
      return;
    }
    try {
      area.get([SESSION_ADDRESS_KEY], (result) => {
        const value = result?.[SESSION_ADDRESS_KEY];
        resolve(typeof value === 'string' && value ? value : null);
      });
    } catch (e) {
      console.warn('Session storage read failed:', e);
      resolve(null);
    }
  });
}

function setSessionAddress(address: string): void {
  const area = sessionArea();
  if (!area) return;
  try {
    area.set({ [SESSION_ADDRESS_KEY]: address }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    console.warn('Session storage write failed:', e);
  }
}

function clearSessionAddress(): void {
  const area = sessionArea();
  if (!area) return;
  try {
    area.remove([SESSION_ADDRESS_KEY], () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    console.warn('Session storage clear failed:', e);
  }
}

function abbreviateAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

/** Paint the wallet header for a known address (cached or freshly resolved). */
function renderConnectedAddress(publicKey: string) {
  const addressEl = document.getElementById('wallet-address') as HTMLSpanElement | null;
  if (addressEl) addressEl.textContent = abbreviateAddress(publicKey);

  const walletInfo = document.getElementById('wallet-info') as HTMLElement | null;
  if (walletInfo) walletInfo.classList.remove('hidden');

  const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement | null;
  if (connectBtn) {
    connectBtn.textContent = '✓ Connected';
    connectBtn.disabled = true;
  }
}

async function connectWallet() {
  try {
    const freighter = (window as any).freighter;
    if (!freighter) {
      alert('Please install the Freighter wallet extension.');
      return;
    }

    const publicKey = await freighter.getPublicKey();
    currentPublicKey = publicKey;
    setSessionAddress(publicKey);
    renderConnectedAddress(publicKey);

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
    const profileData = profile?.data ?? profile;
    const total = Number.parseFloat(profileData?.totalDonatedXLM || "0") || 0;
    const badgeTier = Array.isArray(profileData?.badges)
      ? profileData.badges[0]?.tier || null
      : null;
    renderDonorStats(total, badgeTier);
    await saveTotalDonated(total);

  } catch (err: any) {
    console.error('Wallet connect error:', err);
    alert('Failed to connect wallet: ' + (err.message || 'Unknown error'));
  }
}

/**
 * Restore the wallet header on popup open (#1132).
 *
 * 1. Read the address cached in `chrome.storage.session` and paint it
 *    synchronously so the popup never shows an empty wallet.
 * 2. Re-validate against Freighter in the background; if the user switched
 *    accounts, the display and the cache are updated to the new address.
 */
async function restoreWalletSession() {
  const cached = await getSessionAddress();
  if (cached) {
    currentPublicKey = cached;
    renderConnectedAddress(cached);
  }

  const freighter = (window as any).freighter;
  if (!freighter) {
    // No wallet available — drop any stale cached address.
    if (cached) clearSessionAddress();
    return;
  }

  try {
    const publicKey: string = await freighter.getPublicKey();
    if (!publicKey) return;
    if (publicKey !== currentPublicKey) {
      console.log('[GreenPay] Connected wallet changed — updating');
      currentPublicKey = publicKey;
      renderConnectedAddress(publicKey);
      setSessionAddress(publicKey);
    }
  } catch (err) {
    // Freighter locked / unreachable — keep showing the cached address.
    console.warn('Wallet re-validation failed (showing cached address):', err);
  }
}

// ==================== DONATION HELPERS (keep your existing ones) ====================
// buildDonationTransaction, signWithFreighter, submitTransaction, recordDonation, etc.

// After successful donation in your submit handler, add:
// await updateTotalAfterDonation(parseFloat(amount));

// ==================== MAIN INIT ====================

const onboardingSteps = [
  {
    title: "What is GreenPay?",
    description:
      "GreenPay helps you discover climate projects and support them with Stellar payments.",
  },
  {
    title: "Connect Freighter wallet",
    description:
      "Connect your Freighter wallet to GreenPay on the selected Stellar network. Review each request in Freighter before signing a donation.",
  },
  {
    title: "Find your first project",
    description:
      "Choose an active climate project from the catalog or search for one to prepare your first donation.",
  },
];

function closeOnboarding(overlay: HTMLElement) {
  const previousFocus = (overlay as any).__previousFocus as HTMLElement | null;
  overlay.remove();
  previousFocus?.focus();
}

function trapFocus(overlay: HTMLElement, e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeOnboarding(overlay);
    return;
  }

  if (e.key !== "Tab") return;

  const card = overlay.querySelector<HTMLElement>(".onboarding-card");
  if (!card) return;

  const focusable = card.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function renderOnboardingStep(overlay: HTMLElement, stepIndex: number) {
  const step = onboardingSteps[stepIndex];
  overlay.dataset.step = String(stepIndex + 1);
  overlay.innerHTML = `
    <section class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <p class="onboarding-progress">Step ${stepIndex + 1} of ${onboardingSteps.length}</p>
      <h2 id="onboarding-title" tabindex="-1">${step.title}</h2>
      <p class="onboarding-description">${step.description}</p>
      <p class="onboarding-error" role="status" aria-live="polite"></p>
      <div class="onboarding-actions">
        ${stepIndex > 0 ? '<button class="btn onboarding-back" type="button">Back</button>' : ""}
        ${stepIndex < onboardingSteps.length - 1
          ? '<button class="btn onboarding-next" type="button">Next</button>'
          : '<button class="btn onboarding-done" type="button">Got it</button>'}
      </div>
    </section>
  `;

  overlay.querySelector<HTMLButtonElement>(".onboarding-back")?.addEventListener(
    "click",
    () => renderOnboardingStep(overlay, stepIndex - 1),
  );
  overlay.querySelector<HTMLButtonElement>(".onboarding-next")?.addEventListener(
    "click",
    () => renderOnboardingStep(overlay, stepIndex + 1),
  );
  overlay.querySelector<HTMLButtonElement>(".onboarding-done")?.addEventListener(
    "click",
    (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      chrome.storage.local.set({ onboarded: true }, () => {
        if (chrome.runtime.lastError) {
          button.disabled = false;
          const error = overlay.querySelector<HTMLElement>(".onboarding-error");
          if (error) error.textContent = "Could not save your progress. Please try again.";
          return;
        }
        closeOnboarding(overlay);
      });
    },
  );

  overlay.querySelector<HTMLElement>("#onboarding-title")?.focus();
}

function showOnboardingIfNeeded() {
  chrome.storage.local.get(["onboarded"], (result: Record<string, unknown>) => {
    if (result.onboarded === true) return;

    const main = document.querySelector("main");
    if (!main) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement("div");
    overlay.className = "onboarding-overlay";
    (overlay as any).__previousFocus = previousFocus;

    const onKeyDown = (e: KeyboardEvent) => trapFocus(overlay, e);
    document.addEventListener("keydown", onKeyDown);
    const observer = new MutationObserver(() => {
      if (!overlay.isConnected) {
        document.removeEventListener("keydown", onKeyDown);
        observer.disconnect();
      }
    });
    observer.observe(main, { childList: true });

    main.appendChild(overlay);
    renderOnboardingStep(overlay, 0);
  });
}

async function initProjectSearch() {
  const searchInput = document.getElementById('project-search') as HTMLInputElement | null;
  const dropdown = document.getElementById('search-dropdown') as HTMLUListElement | null;
  if (!searchInput || !dropdown) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (!query) {
      dropdown.classList.add('hidden');
      return;
    }
    debounce(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/projects?search=${encodeURIComponent(query)}&limit=5`);
        if (res.ok) {
          const json = await res.json();
          const projects: ProjectResult[] = json.data ?? json;
          renderDropdown(projects, dropdown);
        }
      } catch (err) {
        console.warn('Project search failed:', err);
      }
    }, 300);
  });

  searchInput.addEventListener('focus', () => {
    if (dropdown.children.length > 0) dropdown.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
      dropdown.classList.add('hidden');
    }
  });
}

async function initSiteOptin() {
  const panel = document.getElementById('site-optin-panel');
  const domainEl = document.getElementById('current-site-domain');
  const toggle = document.getElementById('site-optin-toggle') as HTMLInputElement | null;
  const statusEl = document.getElementById('site-optin-status');

  if (!panel || !domainEl || !toggle || !statusEl) return;
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab?.url) return;

    const hostname = getHostnameFromUrl(activeTab.url);
    if (!hostname) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    domainEl.textContent = hostname;

    const settings = await loadSettings();
    const isAllowed = isUrlAllowed(activeTab.url, settings.allowlist);
    toggle.checked = isAllowed;
    statusEl.textContent = isAllowed
      ? 'Widget enabled on this site'
      : 'Widget disabled on this site';
    statusEl.classList.toggle('enabled', isAllowed);

    toggle.addEventListener('change', async () => {
      const checked = toggle.checked;
      statusEl.textContent = checked ? 'Enabling widget…' : 'Disabling widget…';

      try {
        if (checked) {
          await addSiteToAllowlist(`${hostname}/*`);
          statusEl.textContent = 'Widget enabled on this site';
          statusEl.classList.add('enabled');

          if (activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, { action: 'checkAllowlist' }, (response) => {
              if (chrome.runtime.lastError || !response) {
                if (chrome.scripting?.executeScript && activeTab.id) {
                  chrome.scripting
                    .executeScript({
                      target: { tabId: activeTab.id },
                      files: ['dist/content-script.js'],
                    })
                    .catch(() => {});
                }
              }
            });
          }
        } else {
          await removeSiteFromAllowlist(hostname);
          statusEl.textContent = 'Widget disabled on this site';
          statusEl.classList.remove('enabled');

          if (activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, { action: 'checkAllowlist' }, () => {
              if (chrome.runtime.lastError) {
                // Ignore if tab closed or script not active
              }
            });
          }
        }
      } catch (err: any) {
        console.error('Failed to update site allowlist:', err);
        statusEl.textContent = 'Failed to update site settings';
      }
    });
  } catch (err) {
    console.warn('Could not query active tab for site opt-in:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  applySettings(settings);
  showOnboardingIfNeeded();
  initSiteOptin();

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
  initPendingSection();

  // Paint the cached wallet address first, then re-validate in the background.
  // Not awaited: the popup must finish wiring up while Freighter is queried.
  void restoreWalletSession();

  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      void connectWallet();
    });
  }
  // Initialize with empty project list to show empty state
  renderProjectList([]);

  // Check for pending context-menu donation
  chrome.storage.local.get(['pendingDonationProjectId', 'pendingDonationAddress'], async (res) => {
    if (res.pendingDonationProjectId) {
      chrome.storage.local.remove('pendingDonationProjectId');
      try {
        const response = await fetch(`${API_BASE}/api/projects/${res.pendingDonationProjectId}`);
        if (response.ok) {
          const json = await response.json();
          const projectData = json.data;
          const searchInput = document.getElementById('project-search') as HTMLInputElement | null;

          if (searchInput && projectData.name) {
            searchInput.value = projectData.name;
          }
        }
      } catch (err: unknown) {
        console.error('Failed to pre-fill project from context menu', err);
      }
    } else if (res.pendingDonationAddress) {
      chrome.storage.local.remove('pendingDonationAddress');
      const destInput = document.getElementById('destination') as HTMLInputElement | null;
      if (destInput) {
        destInput.value = String(res.pendingDonationAddress);
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

    setStatus('Preparing transaction…');
    try {
      const [fee, account] = await Promise.all([server.fetchBaseFee(), server.loadAccount(sourceAddress)]);
      const tx = new TransactionBuilder(account, {
        fee: fee.toString(),
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(Operation.payment({
          destination,
          asset: Asset.native(),
          amount,
        }))
        .addMemo(Memo.text(memo || 'Donated via GreenPay'))
        .setTimeout(180)
        .build();

      setStatus('Please sign in your Freighter wallet…');
      const signedXdr = await signWithFreighter(tx.toXDR());

      setStatus('Submitting transaction…');
      const hash = await submitTransaction(signedXdr);

      // Horizon accepts the transaction before the ledger has applied it, so it
      // is tracked as pending until the background poller sees it land.
      await addPendingDonation({ hash, amount, destination });
      await updateTotalAfterDonation(parseFloat(amount));

      setStatus(
        `⏳ Transaction submitted! Awaiting confirmation. Hash: ${hash.slice(0, 16)}…`,
      );
    } catch (err: any) {
      console.error('Donation error:', err);
      setStatus(`❌ Transaction failed: ${err.message || 'Unknown error'}`, true);
    }
  });

  console.log('🌿 GreenPay Extension initialized with donation badge (#490)');
});