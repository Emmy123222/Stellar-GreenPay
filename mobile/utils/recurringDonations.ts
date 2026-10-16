/**
 * utils/recurringDonations.ts
 * Recurring (monthly) donation management for the mobile app.
 *
 * Persistence model (#1059):
 *  - The backend `GET /api/recurring-donations` is the **source of truth**
 *    for schedules. Because the schedule (next due date, remaining months,
 *    status) is authored and advanced server-side, a device-clock reset or
 *    an app reinstall can no longer make a pledge misfire or disappear —
 *    the full schedule is re-fetched from the backend on the next load.
 *  - AsyncStorage is demoted to a **cache** used for offline display.
 *    Every successful reconciliation writes the server state through to
 *    the cache; every read falls back to it when the backend is unreachable.
 *  - On app mount and on every return to the foreground,
 *    `useRecurringDonations()` re-fetches from the backend and reconciles
 *    the local state by id (server wins on conflicts).
 *
 * Mirrors the structure used by the web app's monthlyGiving.ts (localStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import axios from 'axios';

export const RECURRING_DONATIONS_KEY = 'greenpay_recurring_donations';

function randomId(): string {
  const bytes = new Uint8Array(16);
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without Web Crypto; not used on modern runtimes.
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // 16 bytes -> 26-char base36 id without padding, collision-resistant.
  let value = '';
  for (const byte of bytes) {
    value += byte.toString(36).padStart(2, '0');
  }
  return value;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

/** Stellar public keys are 56-char base32 strings starting with 'G'. */
const DONOR_ADDRESS_RE = /^G[A-Z0-9]{55}$/;

export class RecurringDonationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurringDonationValidationError';
  }
}

/**
 * Normalised HTTP error for every backend call made from this module.
 *
 * The shared axios instance below installs a response interceptor that
 * wraps *any* rejection (real AxiosErrors, test-mock rejections, raw
 * errors) into this shape, so callers can branch on `status` without
 * touching `axios.isAxiosError`.
 */
export class RecurringHttpError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RecurringHttpError';
    this.status = status;
  }
}

/**
 * Dedicated axios instance. `validateStatus: () => true` disables axios'
 * automatic throw-on-non-2xx path so *every* outcome — including mocked
 * responses that omit `status` — funnels through the interceptor below
 * and arrives at the caller as a `RecurringHttpError` (or a resolved
 * response). This keeps the module robust under the repo's jest axios
 * mock, which rejects with plain objects.
 */
const http = axios.create({ validateStatus: () => true });
http.interceptors.response.use(
  (response) => response,
  (error: any) => {
    const normalized =
      error instanceof RecurringHttpError
        ? error
        : new RecurringHttpError(
            error?.message ?? 'Recurring donation request failed',
            typeof error?.response?.status === 'number' ? error.response.status : undefined
          );
    return Promise.reject(normalized);
  }
);

export interface RecurringDonation {
  id: string;
  projectId: string;
  projectName: string;
  amountXLM: string;
  startDate: string;
  nextDueDate: string;
  durationMonths: number | null;
  remainingMonths: number | null;
  status: 'active' | 'cancelled' | 'completed';
  createdAt: string;
  /**
   * Stellar public key of the donor this pledge belongs to. Required for
   * backend persistence: a pledge created without a known donor address
   * stays local-only until it is cancelled or given an address.
   */
  donorAddress?: string;
  /**
   * Backend pledge id once the schedule has been persisted server-side.
   * Reconciliation matches on this key, so re-installs and re-syncs
   * update the existing entry instead of creating duplicates.
   */
  serverId?: string;
  /** ISO timestamp of the last successful reconciliation against the backend. */
  syncedAt?: string;
}

export interface RecurringSyncResult {
  /** The reconciled schedule list (also written through to the cache). */
  donations: RecurringDonation[];
  /**
   * `false` when no reconciliation happened and the cached list was returned
   * as-is — either the backend was unreachable or no donor address is known
   * yet to scope the query.
   */
  remoteAvailable: boolean;
  /** Pledges that were local-only and got created on the backend during this sync. */
  pushed: number;
}

// ── Cache (AsyncStorage) ─────────────────────────────────────────────────────

export async function loadRecurringDonations(): Promise<RecurringDonation[]> {
  try {
    const raw = await AsyncStorage.getItem(RECURRING_DONATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveRecurringDonations(donations: RecurringDonation[]): Promise<void> {
  await AsyncStorage.setItem(RECURRING_DONATIONS_KEY, JSON.stringify(donations));
}

// ── Backend mapping helpers ──────────────────────────────────────────────────

/**
 * Map an API pledge (`mapPledgeRow` in the backend router) to the local
 * `RecurringDonation` shape. All schedule fields come straight from the
 * server — nothing here reads the device clock, which is the core of the
 * #1059 fix: a wiped or skewed local clock can no longer shift a due date.
 */
export function mapServerPledge(pledge: any, donorAddress?: string): RecurringDonation {
  const dueDate = String(pledge.nextDueDate ?? '');
  const createdAt = String(pledge.createdAt ?? new Date(0).toISOString());
  return {
    id: String(pledge.id),
    serverId: String(pledge.id),
    donorAddress: pledge.donorAddress ?? donorAddress,
    projectId: String(pledge.projectId),
    projectName: pledge.projectName ?? 'Recurring donation',
    amountXLM: formatServerAmount(pledge.amountXlm),
    startDate: dueDate.length >= 10 ? dueDate.slice(0, 10) : dueDate,
    nextDueDate: dueDate,
    durationMonths: numericOrNull(pledge.durationMonths),
    remainingMonths: numericOrNull(pledge.remainingMonths),
    status: pledge.status === 'paused' ? 'active' : pledge.status,
    createdAt,
  };
}

/** The backend returns `amountXlm` as a float; display wants a plain string. */
function formatServerAmount(amount: unknown): string {
  const value = typeof amount === 'number' ? amount : parseFloat(String(amount));
  return Number.isFinite(value) ? String(value) : String(amount ?? '');
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `YYYY-MM-DD` from an ISO timestamp, for the backend's `startDate` field. */
function toApiDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
}

// ── Backend calls ────────────────────────────────────────────────────────────

async function fetchServerPledges(donorAddress: string): Promise<RecurringDonation[]> {
  const res = await http.get(`${API_URL}/api/recurring-donations`, {
    params: { donor: donorAddress },
  });
  const body: any = res?.data;
  if (res?.status !== 200 || body?.success !== true || !Array.isArray(body.data)) {
    throw new RecurringHttpError(
      `Unexpected response from GET /api/recurring-donations${
        typeof res?.status === 'number' ? ` (status ${res.status})` : ''
      }`
    );
  }
  return body.data.map((pledge: any) => mapServerPledge(pledge, donorAddress));
}

async function postNewPledge(donation: RecurringDonation): Promise<RecurringDonation | null> {
  if (!donation.donorAddress || !DONOR_ADDRESS_RE.test(donation.donorAddress)) return null;
  // The API models a fixed term only (durationMonths 1–120); open-ended
  // pledges cannot be persisted server-side yet and stay local-only.
  if (donation.durationMonths === null) return null;

  const res = await http.post(`${API_URL}/api/recurring-donations`, {
    donorAddress: donation.donorAddress,
    projectId: donation.projectId,
    amountXlm: parseFloat(donation.amountXLM),
    durationMonths: donation.durationMonths,
    startDate: toApiDate(donation.startDate),
  });
  const body: any = res?.data;
  if (res?.status !== 201 || body?.success !== true || !body.data) {
    return null;
  }
  return mapServerPledge(body.data, donation.donorAddress);
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Re-fetch the donor's pledges from the backend and reconcile them into
 * local state. This is the #1059 core: schedules always converge on the
 * server's copy (source of truth), so a clock reset or reinstall restores
 * the correct `nextDueDate`/status instead of misfiring or losing them.
 *
 * Rules:
 *  - Server entries win on every field for ids both sides know (a local
 *    entry already carrying `serverId`, or one whose id matches a server
 *    UUID after a restore).
 *  - A local entry whose `serverId` is absent from the server response was
 *    deleted upstream — it is dropped rather than resurrected.
 *  - Local-only entries (never persisted, e.g. created offline or without
 *    a donor address) are preserved and, when they now have a valid donor
 *    address and a fixed term, are pushed to the backend as a self-healing
 *    step.
 *  - A live cancellation (local `cancelled`, still `active` on the server
 *    because the DELETE never landed) is kept cancelled locally.
 *  - When the backend is unreachable, the cached list is returned as-is
 *    with `remoteAvailable: false` — offline display, never an error.
 */
export async function syncRecurringDonations(
  explicitDonorAddress?: string
): Promise<RecurringSyncResult> {
  const local = await loadRecurringDonations();
  const donorAddress =
    explicitDonorAddress || local.find((d) => d.donorAddress)?.donorAddress || '';

  if (!DONOR_ADDRESS_RE.test(donorAddress)) {
    return { donations: local, remoteAvailable: false, pushed: 0 };
  }

  let server: RecurringDonation[];
  try {
    server = await fetchServerPledges(donorAddress);
  } catch {
    // Offline / backend down: the cache is display-only, so fall back to it.
    return { donations: local, remoteAvailable: false, pushed: 0 };
  }

  const syncedAt = new Date().toISOString();
  const byServerId = new Map<string, RecurringDonation>();
  for (const entry of local) {
    const key = entry.serverId ?? entry.id;
    if (!byServerId.has(key)) byServerId.set(key, entry);
  }

  const serverIds = new Set(server.map((s) => s.serverId ?? s.id));
  const merged: RecurringDonation[] = [];
  let pushed = 0;

  for (const remote of server) {
    const key = remote.serverId ?? remote.id;
    const existing = byServerId.get(key);
    if (existing?.status === 'cancelled') {
      merged.push(existing);
      continue;
    }
    if (remote.status === 'cancelled') {
      // Cancelled upstream (e.g. from another device) — drop the local copy
      // rather than re-adding a pledge the server considers terminal.
      continue;
    }
    merged.push(
      existing
        ? { ...existing, ...remote, id: existing.id, syncedAt }
        : { ...remote, syncedAt }
    );
  }

  for (const entry of local) {
    const key = entry.serverId ?? entry.id;
    if (serverIds.has(key)) continue; // already merged above
    if (entry.serverId) continue; // deleted upstream — drop the stale copy

    // Local-only pledge: keep it, and try to persist it now that we are online.
    if (entry.status === 'active') {
      try {
        const created = await postNewPledge({ ...entry, donorAddress });
        if (created) {
          merged.push({ ...created, id: entry.id, syncedAt });
          pushed += 1;
          continue;
        }
      } catch {
        // Persistence is best-effort; the local copy remains authoritative
        // for display until the next successful sync.
      }
    }
    merged.push(entry);
  }

  await saveRecurringDonations(merged);
  return { donations: merged, remoteAvailable: true, pushed };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function createRecurringDonation(input: {
  projectId: string;
  projectName: string;
  amountXLM: string;
  durationMonths: number | null;
  donorAddress?: string;
}): Promise<RecurringDonation> {
  if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
    throw new RecurringDonationValidationError('projectId must be a non-empty string');
  }

  const parsedAmount = Number(input.amountXLM);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new RecurringDonationValidationError('amountXLM must be a valid positive number');
  }

  let response: any;
  try {
    response = await http.get(`${API_URL}/api/projects/${input.projectId}`);
  } catch (err: any) {
    if (err?.status === 404) {
      throw new RecurringDonationValidationError(`Project ${input.projectId} does not exist`);
    }
    throw new RecurringDonationValidationError('Unable to verify project before creating recurring donation');
  }
  // With validateStatus disabled, a failed lookup resolves — inspect it directly.
  const body: any = response?.data;
  if (response?.status === 404 || body?.success === false) {
    throw new RecurringDonationValidationError(`Project ${input.projectId} does not exist`);
  }

  const now = new Date().toISOString();
  const donation: RecurringDonation = {
    id: `rec_${randomId()}_${Date.now()}`,
    projectId: input.projectId,
    projectName: input.projectName,
    amountXLM: input.amountXLM,
    startDate: now,
    nextDueDate: now,
    durationMonths: input.durationMonths,
    remainingMonths: input.durationMonths,
    status: 'active',
    createdAt: now,
    donorAddress: input.donorAddress,
  };

  const all = await loadRecurringDonations();
  await saveRecurringDonations([donation, ...all]);

  // Best-effort backend persistence (#1059): the schedule's durable home is
  // the `recurring_donations` table, not this device. If the POST fails
  // (offline, inactive project, open-ended term), the entry stays local-only
  // and `syncRecurringDonations()` will retry it when conditions allow.
  if (donation.donorAddress && donation.durationMonths !== null) {
    try {
      const persisted = await postNewPledge(donation);
      if (persisted) {
        const updated: RecurringDonation = {
          ...persisted,
          id: donation.id,
          projectName: donation.projectName || persisted.projectName,
          amountXLM: donation.amountXLM,
          startDate: donation.startDate,
          syncedAt: new Date().toISOString(),
        };
        const latest = await loadRecurringDonations();
        await saveRecurringDonations(latest.map((d) => (d.id === donation.id ? updated : d)));
        return updated;
      }
    } catch {
      // See above — sync reconciles later.
    }
  }

  return donation;
}

/**
 * Cancel a pledge locally and (when it exists server-side) on the backend.
 * A 404/409 from DELETE means the pledge was already removed or is in a
 * terminal state upstream — the local cancellation is exactly the outcome
 * the caller wanted, so it is treated as success.
 */
export async function cancelRecurringDonation(id: string): Promise<void> {
  const all = await loadRecurringDonations();
  const target = all.find((d) => d.id === id);
  if (!target) return;

  if (target.serverId) {
    try {
      await http.delete(`${API_URL}/api/recurring-donations/${target.serverId}`);
    } catch {
      // The local cancellation below still stands; the next sync
      // reconciles the server copy (server terminal status wins).
    }
  }

  const updated = all.map((d) => (d.id === id ? { ...d, status: 'cancelled' as const } : d));
  await saveRecurringDonations(updated);
}

export interface PaymentRecord {
  id: string;
  donationId: string;
  amountXLM: string;
  projectName: string;
  date: string;
  status: 'completed' | 'failed' | 'pending';
}

export async function loadPaymentHistory(): Promise<PaymentRecord[]> {
  try {
    const raw = await AsyncStorage.getItem('greenpay_payment_history');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function savePaymentHistory(records: PaymentRecord[]): Promise<void> {
  await AsyncStorage.setItem('greenpay_payment_history', JSON.stringify(records));
}

export async function recordPayment(
  donationId: string,
  amountXLM: string,
  projectName: string
): Promise<PaymentRecord> {
  const record: PaymentRecord = {
    id: `pay_${randomId()}_${Date.now()}`,
    donationId,
    amountXLM,
    projectName,
    date: new Date().toISOString(),
    status: 'completed',
  };
  const all = await loadPaymentHistory();
  await savePaymentHistory([record, ...all]);
  return record;
}

// ── Foreground sync ──────────────────────────────────────────────────────────

/**
 * In-flight reconciliation promise, shared across hook instances so two
 * screens mounting at once (or a focus event racing a foreground event)
 * never trigger duplicate backend round-trips.
 */
let inFlightSync: Promise<RecurringSyncResult> | null = null;

export function refreshRecurringDonations(
  donorAddress?: string
): Promise<RecurringSyncResult> {
  if (!inFlightSync) {
    const promise = syncRecurringDonations(donorAddress).finally(() => {
      if (inFlightSync === promise) inFlightSync = null;
    });
    inFlightSync = promise;
  }
  return inFlightSync;
}

export interface UseRecurringDonationsOptions {
  /**
   * When provided, overrides any donor address found in the local cache.
   * Screens that know the connected address (e.g. from the donate flow)
   * should pass it so the very first fetch targets the right donor.
   */
  donorAddress?: string;
}

export interface UseRecurringDonationsResult {
  donations: RecurringDonation[];
  /** True while a backend reconciliation is running. */
  isSyncing: boolean;
  /** Set when the last reconciliation failed for a non-offline reason. */
  error: string | null;
  /** Force a re-fetch + reconcile (also fired on mount and foreground). */
  refresh: () => Promise<void>;
  /** Create a pledge (locally + best-effort backend) and apply it to local state. */
  create: (input: {
    projectId: string;
    projectName: string;
    amountXLM: string;
    durationMonths: number | null;
    donorAddress?: string;
  }) => Promise<RecurringDonation>;
  /** Cancel a pledge (locally + backend when server-side) and apply it to local state. */
  cancel: (id: string) => Promise<void>;
}

/**
 * Hook backing acceptance criterion 3 of #1059: whenever the app is
 * mounted or returns to the foreground, schedules are re-fetched from the
 * backend and reconciled against local state instead of trusting whatever
 * AsyncStorage happened to contain. The cache renders instantly while the
 * refresh runs (`useFocusEffect` alone does not cover foreground returns).
 */
export function useRecurringDonations(
  options: UseRecurringDonationsOptions = {}
): UseRecurringDonationsResult {
  const [donations, setDonations] = useState<RecurringDonation[]>([]);
  const [isSyncing, setIsSyncing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const donorAddressRef = useRef(options.donorAddress);
  donorAddressRef.current = options.donorAddress;

  const refresh = useCallback(async () => {
    setIsSyncing(true);
    try {
      // Show the cached schedule immediately (offline-first display), then
      // let the backend response replace it once reconciled.
      const cached = await loadRecurringDonations();
      if (mountedRef.current) setDonations(cached);

      const result = await refreshRecurringDonations(donorAddressRef.current);
      if (mountedRef.current) {
        setDonations(result.donations);
        setError(null);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err?.message ?? 'Unable to refresh recurring donations');
      }
    } finally {
      if (mountedRef.current) setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const prevStateRef: { current: AppStateStatus } = {
      current: AppState.currentState,
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      const prevState = prevStateRef.current;
      prevStateRef.current = nextState;
      if (
        (prevState === 'background' || prevState === 'inactive') &&
        nextState === 'active'
      ) {
        void refresh();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);

  const create = useCallback(
    async (input: {
      projectId: string;
      projectName: string;
      amountXLM: string;
      durationMonths: number | null;
      donorAddress?: string;
    }): Promise<RecurringDonation> => {
      const donation = await createRecurringDonation({
        ...input,
        donorAddress: input.donorAddress ?? donorAddressRef.current,
      });
      if (mountedRef.current) {
        setDonations(await loadRecurringDonations());
      }
      return donation;
    },
    []
  );

  const cancel = useCallback(async (id: string): Promise<void> => {
    await cancelRecurringDonation(id);
    if (mountedRef.current) {
      setDonations(await loadRecurringDonations());
    }
  }, []);

  return { donations, isSyncing, error, refresh, create, cancel };
}
