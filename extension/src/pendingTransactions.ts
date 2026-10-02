export interface PendingDonation {
  hash: string;
  amount: string;
  destination: string;
  createdAt: number;
}

export const PENDING_STORAGE_KEY = 'pendingDonations';

// Donations are built with a 180s ledger timeout; a transaction Horizon has
// still never seen past this grace window is treated as failed and dropped.
const PENDING_TTL_MS = 5 * 60 * 1000;

const TOTAL_DONATED_STORAGE_KEY = 'totalDonatedXLM';
const PENDING_BADGE_COLOR = '#ef4444';
const DONATION_BADGE_COLOR = '#10b981';

type Network = 'testnet' | 'mainnet';

const HORIZON_URLS: Record<Network, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
};

interface ActionApi {
  setBadgeText(details: { text: string }): void | Promise<unknown>;
  setBadgeBackgroundColor(details: { color: string }): void | Promise<unknown>;
}

function getActionApi(): ActionApi | undefined {
  const chromeApi = typeof chrome !== 'undefined' ? chrome.action : undefined;
  if (chromeApi) return chromeApi;
  const browser = (globalThis as any).browser;
  return browser?.action ?? browser?.browserAction;
}

export function horizonUrlForNetwork(network: Network): string {
  return HORIZON_URLS[network];
}

export function stellarExpertTxUrl(hash: string, network: Network): string {
  return `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}/tx/${encodeURIComponent(hash)}`;
}

export async function getNetwork(): Promise<Network> {
  const stored = await chrome.storage.sync.get('network');
  return stored.network === 'mainnet' ? 'mainnet' : 'testnet';
}

export async function getPendingDonations(): Promise<PendingDonation[]> {
  const stored = await chrome.storage.local.get(PENDING_STORAGE_KEY);
  const list = stored[PENDING_STORAGE_KEY];
  return Array.isArray(list) ? (list as PendingDonation[]) : [];
}

async function writePendingDonations(list: PendingDonation[]): Promise<void> {
  await chrome.storage.local.set({ [PENDING_STORAGE_KEY]: list });
  await syncBadge();
}

export async function addPendingDonation(
  donation: Omit<PendingDonation, 'createdAt'>
): Promise<void> {
  const pending = await getPendingDonations();
  if (pending.some((tx) => tx.hash === donation.hash)) return;
  await writePendingDonations([...pending, { ...donation, createdAt: Date.now() }]);
}

type TxStatus = 'confirmed' | 'failed' | 'pending';

async function lookupTxStatus(hash: string): Promise<TxStatus> {
  const horizon = horizonUrlForNetwork(await getNetwork());
  try {
    const res = await fetch(`${horizon}/transactions/${encodeURIComponent(hash)}`);
    if (res.status === 404) return 'pending';
    if (!res.ok) return 'pending';
    const tx = await res.json();
    const successful = tx.result_successful ?? tx.successful;
    return successful === false ? 'failed' : 'confirmed';
  } catch {
    // Horizon unreachable: keep the transaction in flight instead of guessing.
    return 'pending';
  }
}

/**
 * Re-check every in-flight donation against Horizon and drop the ones that have
 * settled (confirmed, failed, or timed out). Removal-only writes keep a
 * concurrent popup/background pass from resurrecting settled transactions.
 */
export async function checkPendingDonations(): Promise<PendingDonation[]> {
  const pending = await getPendingDonations();
  const settled = new Set<string>();

  await Promise.all(
    pending.map(async (tx) => {
      const status = await lookupTxStatus(tx.hash);
      if (status !== 'pending' || Date.now() - tx.createdAt > PENDING_TTL_MS) {
        settled.add(tx.hash);
      }
    })
  );

  if (settled.size === 0) {
    await syncBadge();
    return pending;
  }

  const remaining = (await getPendingDonations()).filter((tx) => !settled.has(tx.hash));
  await writePendingDonations(remaining);
  return remaining;
}

function abbreviateNumber(num: number): string {
  if (num < 1000) return Math.floor(num).toString();
  if (num < 1000000) return Math.floor(num / 1000) + 'K';
  return (num / 1000000).toFixed(1) + 'M';
}

/**
 * Pending transactions win the badge: a red dot flags work in flight, and the
 * lifetime donation total (green) returns once everything has settled.
 */
export async function syncBadge(): Promise<void> {
  const action = getActionApi();
  if (!action) return;

  try {
    if ((await getPendingDonations()).length > 0) {
      await action.setBadgeText({ text: '•' });
      await action.setBadgeBackgroundColor({ color: PENDING_BADGE_COLOR });
      return;
    }

    const stored = await chrome.storage.local.get(TOTAL_DONATED_STORAGE_KEY);
    const totalXLM = Number(stored[TOTAL_DONATED_STORAGE_KEY]) || 0;
    const text = totalXLM > 0 ? abbreviateNumber(totalXLM) : '';
    await action.setBadgeText({ text });
    await action.setBadgeBackgroundColor({ color: DONATION_BADGE_COLOR });
  } catch (err) {
    console.error('Badge update failed:', err);
  }
}
