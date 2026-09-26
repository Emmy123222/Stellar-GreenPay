import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { loadSettings, type ExtensionSettings } from './settings';
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

} from "@stellar/stellar-sdk";
import { loadSettings, type ExtensionSettings } from "./settings";

// Module-level vars
let API_BASE = "https://api.stellar-greenpay.app";
let NETWORK_PASSPHRASE: string = Networks.TESTNET;
let currentNetwork: 'testnet' | 'mainnet' = 'testnet';
let horizonUrl = 'https://horizon-testnet.stellar.org';
let horizonUrl = "https://horizon-testnet.stellar.org";
let server = new Horizon.Server(horizonUrl);

function applySettings(settings: ExtensionSettings) {
  API_BASE = settings.backendUrl;
  currentNetwork = settings.network === 'mainnet' ? 'mainnet' : 'testnet';
  if (settings.network === 'mainnet') {
    NETWORK_PASSPHRASE = Networks.PUBLIC;
  } else {
    NETWORK_PASSPHRASE = Networks.TESTNET;
  if (settings.network === "mainnet") {
    NETWORK_PASSPHRASE = Networks.PUBLIC;
    horizonUrl = "https://horizon.stellar.org";
  } else {
    NETWORK_PASSPHRASE = Networks.TESTNET;
    horizonUrl = "https://horizon-testnet.stellar.org";
  }
  horizonUrl = horizonUrlForNetwork(currentNetwork);
  server = new Horizon.Server(horizonUrl);
}

// ==================== BADGE HELPERS ====================
function abbreviateNumber(num: number): string {
  if (num < 1000) return Math.floor(num).toString();
  if (num < 1000000) return Math.floor(num / 1000) + "K";
  return (num / 1000000).toFixed(1) + "M";
}

async function updateDonationBadge(totalXLM: number) {
  const text = abbreviateNumber(totalXLM);
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    console.log(`[GreenPay Badge] Updated: ${text} (${totalXLM} XLM)`);
  } catch (e) {
    console.error("Badge update failed:", e);
  }
}

async function signWithFreighter(xdr: string): Promise<string> {
  const freighter = (window as any).freighter;
  if (!freighter) throw new Error("Freighter extension not found");

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
  const list = document.getElementById(
    "project-list",
  ) as HTMLUListElement | null;
  if (!list) return;

  list.innerHTML = "";
  projectListItems = [];
  activeProjectListIndex = -1;

  if (projects.length === 0) {
    const empty = document.createElement("li");
    empty.className = "glass-panel project-item";
    empty.textContent = "No saved projects yet.";
    list.appendChild(empty);
    return;
  }

  projects.forEach((p) => {
    const li = document.createElement("li");
    li.className = "glass-panel project-item";
    li.setAttribute("tabindex", "0");
    li.setAttribute("role", "option");
    li.setAttribute(
      "aria-label",
      `${escapeHtml(p.name)}, ${escapeHtml(p.category)}`,
    );
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
    li.addEventListener("click", () => {
      selectProjectListItem(li, p);
    });

    // Allow keyboard activation via Enter/Space
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectProjectListItem(li, p);
      }
    });

    list.appendChild(li);
    projectListItems.push(li);
  });

  // Update badge count
  const badge = document.querySelector(".section-header .badge");
  if (badge) badge.textContent = String(projects.length);
}

function selectProjectListItem(li: HTMLLIElement, p: ProjectResult) {
  // Highlight the selected item
  projectListItems.forEach((el) => el.classList.remove("active"));
  li.classList.add("active");

  // Pre-fill the destination address field
  const destInput = document.getElementById(
    "destination",
  ) as HTMLInputElement | null;
  const searchInput = document.getElementById(
    "project-search",
  ) as HTMLInputElement | null;
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
      el.classList.add("active");
      el.focus();
    } else {
      el.classList.remove("active");
    }
  });
}

/** Map a project category to a representative emoji. */
function getProjectEmoji(category: string): string {
  const map: Record<string, string> = {
    Reforestation: "🌳",
    "Solar Energy": "☀️",
    "Ocean Conservation": "🌊",
    "Clean Water": "💧",
    "Wildlife Protection": "🦁",
    "Carbon Capture": "♻️",
    "Wind Energy": "💨",
    "Sustainable Agriculture": "🌾",
  };
  return map[category] ?? "🌿";
}

function initProjectListKeyNav() {
  const list = document.getElementById(
    "project-list",
  ) as HTMLUListElement | null;
  if (!list) return;

  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Saved projects");

  list.addEventListener("keydown", (e) => {
    if (projectListItems.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeProjectListIndex = Math.min(
        activeProjectListIndex + 1,
        projectListItems.length - 1,
      );
      highlightProjectListItem(activeProjectListIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeProjectListIndex = Math.max(activeProjectListIndex - 1, 0);
      highlightProjectListItem(activeProjectListIndex);
    } else if (e.key === "Enter" && activeProjectListIndex >= 0) {
      projectListItems[activeProjectListIndex]?.click();
    } else if (e.key === "Escape") {
      window.close();
    }
  });
}

function debounce(fn: () => void, ms: number) {
  if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(fn, ms);
}

function renderDropdown(projects: ProjectResult[], dropdown: HTMLUListElement) {
  dropdown.innerHTML = "";
  dropdownItems = [];
  activeDropdownIndex = -1;

  if (projects.length === 0) {
    const empty = document.createElement("li");
    empty.className = "search-no-results";
    empty.textContent = "No projects found";
    dropdown.appendChild(empty);
    dropdown.classList.remove("hidden");
    return;
  }

  projects.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <div class="search-result-name">${escapeHtml(p.name)}</div>
        <div class="search-result-cat">${escapeHtml(p.category)}</div>
      </div>
    `;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const destInput = document.getElementById(
        "destination",
      ) as HTMLInputElement | null;
      const searchInput = document.getElementById(
        "project-search",
      ) as HTMLInputElement | null;
      if (p.walletAddress && destInput) {
        destInput.value = p.walletAddress;
        selectedProjectId = p.id;
      }
      if (searchInput) {
        searchInput.value = p.name;
      }
      dropdown.classList.add("hidden");
    });
  });
}

// ==================== PENDING TRANSACTIONS ====================

async function renderPendingFromStorage() {
  renderPendingDonations(await getPendingDonations());
}

async function refreshPendingSection() {
  renderPendingDonations(await checkPendingDonations());
}

function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function formatAge(createdAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function renderPendingDonations(donations: PendingDonation[]) {
  const section = document.getElementById('pending-section');
  const list = document.getElementById('pending-list') as HTMLUListElement | null;
  const count = document.getElementById('pending-count');
  if (!section || !list || !count) return;

  list.innerHTML = '';
  count.textContent = String(donations.length);
  section.classList.toggle('hidden', donations.length === 0);

  donations.forEach((donation) => {
    const info = document.createElement('div');
    info.className = 'pending-info';

    const amount = document.createElement('div');
    amount.className = 'pending-amount';
    amount.textContent = `${donation.amount} XLM pending`;

    const recipient = document.createElement('div');
    recipient.className = 'pending-dest';
    recipient.textContent = `to ${truncateAddress(donation.destination)} · ${formatAge(donation.createdAt)}`;

    info.append(amount, recipient);

    const link = document.createElement('a');
    link.className = 'pending-link';
    link.href = stellarExpertTxUrl(donation.hash, currentNetwork);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Stellar Expert';

    const item = document.createElement('li');
    item.className = 'glass-panel pending-item';
    item.append(info, link);
    list.appendChild(item);
  });
}

function initPendingSection() {
  void refreshPendingSection();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[PENDING_STORAGE_KEY]) void renderPendingFromStorage();
  });

  window.setInterval(() => void refreshPendingSection(), 15000);
}

async function saveTotalDonated(total: number) {
  return new Promise<void>((resolve) => {
    // syncBadge gives the pending red dot precedence while a donation is in
    // flight, and restores the donation total once everything has settled.
    chrome.storage.local.set({ totalDonatedXLM: Math.max(0, total) }, async () => {
      await syncBadge();
      resolve();
    });
  });
}

async function updateTotalAfterDonation(amount: number) {
  chrome.storage.local.get(
    ["totalDonatedXLM"],
    async (result: Record<string, unknown>) => {
      const current = (result.totalDonatedXLM as number) || 0;
      await saveTotalDonated(current + amount);
    },
  );
}

// ==================== PROFILE API ====================
async function fetchProfile(publicKey: string): Promise<any> {
  try {
    const res = await fetch(
      `${API_BASE}/api/profiles/${encodeURIComponent(publicKey)}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("Profile fetch failed (using local storage fallback):", e);
    return null;
  }
}

// ==================== WALLET CONNECT ====================
let currentPublicKey: string | null = null;

async function connectWallet() {
  try {
    const freighter = (window as any).freighter;
    if (typeof freighter === "undefined") {
      setStatus("Please install the Freighter wallet extension.", true);
      const link = document.createElement("a");
      link.href = "https://www.freighter.app/";
      link.target = "_blank";
      link.click();
      return;
    }

    const publicKey = await freighter.getPublicKey();
    currentPublicKey = publicKey;

    // UI Updates
    const addressEl = document.getElementById(
      "wallet-address",
    ) as HTMLSpanElement | null;
    if (addressEl)
      addressEl.textContent = `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}`;

    const walletInfo = document.getElementById(
      "wallet-info",
    ) as HTMLElement | null;
    if (walletInfo) walletInfo.classList.remove("hidden");

    const connectBtn = document.getElementById(
      "connect-btn",
    ) as HTMLButtonElement | null;
    if (connectBtn) {
      connectBtn.textContent = "✓ Connected";
      connectBtn.disabled = true;
    }

    // Fetch total donated from backend
    const profile = await fetchProfile(publicKey);
    let total = 0;
    if (profile?.data?.totalDonatedXLM || profile?.totalDonatedXLM) {
      total =
        parseFloat(profile.data?.totalDonatedXLM || profile.totalDonatedXLM) ||
        0;
    }
    await saveTotalDonated(total);
  } catch (err: any) {
    console.error("Wallet connect error:", err);
    setStatus(
      `Failed to connect wallet: ${err.message || "Unknown error"}`,
      true,
    );
  }
}

// ==================== DONATION HELPERS (keep your existing ones) ====================
// buildDonationTransaction, signWithFreighter, submitTransaction, recordDonation, etc.

// After successful donation in your submit handler, add:
// await updateTotalAfterDonation(parseFloat(amount));

// ==================== MAIN INIT ====================

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setStatus(message: string, isError = false) {
  const statusEl = document.getElementById("status-message");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#ef4444" : "#10b981";
  }
}

async function initProjectSearch() {
  const searchInput = document.getElementById(
    "project-search",
  ) as HTMLInputElement | null;
  const dropdown = document.getElementById(
    "search-dropdown",
  ) as HTMLUListElement | null;
  if (!searchInput || !dropdown) return;

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    if (!query) {
      dropdown.classList.add("hidden");
      return;
    }
    debounce(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/projects?search=${encodeURIComponent(query)}&limit=5`,
        );
        if (res.ok) {
          const json = await res.json();
          const projects: ProjectResult[] = json.data ?? json;
          renderDropdown(projects, dropdown);
        }
      } catch (err) {
        console.warn("Project search failed:", err);
      }
    }, 300);
  });

  searchInput.addEventListener("focus", () => {
    if (dropdown.children.length > 0) dropdown.classList.remove("hidden");
  });

  document.addEventListener("click", (e) => {
    if (
      !searchInput.contains(e.target as Node) &&
      !dropdown.contains(e.target as Node)
    ) {
      dropdown.classList.add("hidden");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await loadSettings();
  applySettings(settings);

  // Check if Freighter is installed
  const freighter = (window as any).freighter;
  if (typeof freighter === "undefined") {
    const form = document.getElementById("donation-form");
    if (form) {
      form.innerHTML = `
        <div style="padding: 20px; text-align: center; background: rgba(239, 68, 68, 0.1); border-radius: 8px; border: 1px solid #ef4444;">
          <h2 style="color: #ef4444; margin-bottom: 10px;">Freighter Wallet Required</h2>
          <p style="margin-bottom: 15px;">GreenPay requires the Freighter wallet extension to process donations.</p>
          <a href="https://www.freighter.app/" target="_blank" style="
            display: inline-block;
            background: #ef4444;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
          ">Install Freighter Wallet</a>
        </div>
      `;
    }
    return;
  }

  // Pre-fill donation amount from saved default
  const amountInput = document.getElementById(
    "custom-amount-input",
  ) as HTMLInputElement | null;
  if (amountInput && settings.defaultDonationAmount) {
    amountInput.value = settings.defaultDonationAmount;
  }

  // Wire settings button
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      window.location.href = "settings.html";
    });
  }

  initProjectSearch();
  initProjectListKeyNav();
  initPendingSection();

  // Check for pending context-menu donation
  chrome.storage.local.get(
    ["pendingDonationProjectId", "pendingDonationAddress"],
    async (res) => {
      if (res.pendingDonationProjectId) {
        chrome.storage.local.remove("pendingDonationProjectId");
        try {
          const response = await fetch(
            `${API_BASE}/api/projects/${res.pendingDonationProjectId}`,
          );
          if (response.ok) {
            const json = await response.json();
            const projectData = json.data;

            const destInput = document.getElementById(
              "destination",
            ) as HTMLInputElement | null;
            const searchInput = document.getElementById(
              "project-search",
            ) as HTMLInputElement | null;

            if (destInput && projectData.walletAddress) {
              destInput.value = projectData.walletAddress;
              selectedProjectId = projectData.id;
            }
            if (searchInput && projectData.name) {
              searchInput.value = projectData.name;
            }
          }
        } catch (err: unknown) {
          console.error("Failed to pre-fill project from context menu", err);
        }
      } else if (res.pendingDonationAddress) {
        chrome.storage.local.remove("pendingDonationAddress");
        const destInput = document.getElementById(
          "destination",
        ) as HTMLInputElement | null;
        if (destInput) {
          destInput.value = String(res.pendingDonationAddress);
        }
      }
    },
  );

  const form = document.getElementById("donation-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sourceAddress = (
      (document.getElementById("source-address") as HTMLInputElement)?.value ??
      ""
    ).trim();
    const destination = (
      (document.getElementById("destination") as HTMLInputElement)?.value ?? ""
    ).trim();
    const amount = (
      (document.getElementById("amount") as HTMLInputElement)?.value ?? ""
    ).trim();
    const memo = (
      (document.getElementById("memo") as HTMLInputElement)?.value ?? ""
    ).trim();

    if (!sourceAddress || !destination || !amount) {
      setStatus("Please fill in all required fields.", true);
      return;
    }

    setStatus("Preparing transaction…");
    try {
      const [fee, account] = await Promise.all([
        server.fetchBaseFee(),
        server.loadAccount(sourceAddress),
      ]);
      const tx = new TransactionBuilder(account, {
        fee: fee.toString(),
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount,
          }),
        )
        .addMemo(Memo.text(memo || "Donated via GreenPay"))
        .setTimeout(180)
        .build();

      setStatus("Please sign in your Freighter wallet…");
      const signedXdr = await signWithFreighter(tx.toXDR());

      setStatus("Submitting transaction…");
      const hash = await submitTransaction(signedXdr);

      // Horizon accepts the transaction before the ledger has applied it, so it
      // is tracked as pending until the background poller sees it land.
      await addPendingDonation({ hash, amount, destination });
      await updateTotalAfterDonation(parseFloat(amount));

      setStatus(`⏳ Transaction submitted! Awaiting confirmation. Hash: ${hash.slice(0, 16)}…`);
    } catch (err: any) {
      console.error("Donation error:", err);
      setStatus(
        `❌ Transaction failed: ${err.message || "Unknown error"}`,
        true,
      );
    }
  });

  console.log("🌿 GreenPay Extension initialized with donation badge (#490)");
});
