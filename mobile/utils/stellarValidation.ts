/**
 * utils/stellarValidation.ts
 * Lightweight Stellar address validation for the mobile app.
 * Mirrors the regex used in the backend donations route.
 *
 * Issue #1126: a well-formed G-address tells us nothing about *which*
 * network the account lives on. Friendbot hands out brand-new testnet
 * accounts for free, so pasting one of those keys into a mainnet build
 * yields a perfectly valid address that silently swallows the payment.
 *
 * This module therefore resolves the configured network from the
 * environment and returns a **soft** warning for addresses we know are
 * testnet-only. Nothing here ever rejects a valid address: the caller
 * shows the warning and lets the user confirm (AC: "soft warning, not a
 * hard block — user must confirm").
 *
 * How an address becomes "known testnet-only":
 *   1. `builtin`  — a placeholder key that no faucet can fund and that is
 *                   never a real mainnet destination.
 *   2. `friendbot` — recorded by this app the moment it hands a user a
 *                   Friendbot link (testnet-only by construction).
 *   3. `api`      — pushed in by the backend when it recognises a
 *                   project/donor address it has only ever seen on testnet.
 * Records survive restarts via AsyncStorage so switching the app to a
 * mainnet build still flags the account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type StellarNetwork = 'mainnet' | 'testnet';

/** Where the "this is testnet-only" fact came from. */
export type TestnetAddressSource = 'builtin' | 'friendbot' | 'api';

export interface KnownTestnetAddress {
  address: string;
  source: TestnetAddressSource;
  recordedAt: string;
}

export const TESTNET_ADDRESS_STORAGE_KEY = 'greenpay_known_testnet_addresses';

/**
 * StrKey encoding of the all-zero ed25519 public key: the canonical
 * placeholder/burn key. No secret key is known for it, so no faucet can
 * fund it and it is never a legitimate payment destination. Flagging it
 * on mainnet costs the user nothing and catches copy-pasted fixtures.
 */
export const ZEROED_PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const BUILTIN_TESTNET_ADDRESSES: readonly KnownTestnetAddress[] = [
  // `recordedAt` is a fixed sentinel, not a date: the entry predates us.
  { address: ZEROED_PUBLIC_KEY, source: 'builtin', recordedAt: '1970-01-01T00:00:00.000Z' },
];

/** Address registries are small; the cap keeps a hostile payload bounded. */
const MAX_RECORDED_TESTNET_ADDRESSES = 200;

const recordedTestnetAddresses = new Map<string, KnownTestnetAddress>();

/**
 * Normalises user input (pasted with whitespace, lowercase, …) into the
 * canonical form used for registry lookups. Returns `null` when the value
 * is not a valid address at all, so callers get one validity answer.
 */
function normalizeAddress(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const trimmed = address.trim().toUpperCase();
  return isValidStellarAddress(trimmed) ? trimmed : null;
}

/**
 * Resolves the network the app is configured for.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so the reads
 * below must stay static member expressions. `STELLAR_NETWORK` is accepted
 * as a fallback so a single env file (`.env.mainnet.example`) drives both
 * the backend and the app. Unset/unrecognised values fall back to
 * `testnet`, matching the backend default in
 * `backend/src/services/stellar.js`.
 *
 * @param env override, primarily for tests — Babel's env inlining makes
 *   `process.env` mutations invisible to this module under Jest.
 */
export function getStellarNetwork(env?: Record<string, string | undefined>): StellarNetwork {
  const raw = (
    env
      ? env.EXPO_PUBLIC_STELLAR_NETWORK ?? env.STELLAR_NETWORK
      : process.env.EXPO_PUBLIC_STELLAR_NETWORK || process.env.STELLAR_NETWORK
  )?.trim().toLowerCase();

  return raw === 'mainnet' || raw === 'public' ? 'mainnet' : 'testnet';
}

/** True when the app is running against public/mainnet. */
export function isMainnet(env?: Record<string, string | undefined>): boolean {
  return getStellarNetwork(env) === 'mainnet';
}

/**
 * Records an address as testnet-only (e.g. the account we just sent the
 * user to Friendbot to fund). In-memory only — call
 * `persistKnownTestnetAddresses()` to survive a restart.
 *
 * @returns the stored record, or `null` if the address is not a valid
 *   Stellar public key.
 */
export function markTestnetAddress(
  address: unknown,
  source: TestnetAddressSource = 'friendbot',
  recordedAt: string = new Date().toISOString()
): KnownTestnetAddress | null {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  // Built-ins are facts, not observations — never let a record overwrite
  // their provenance.
  const builtin = BUILTIN_TESTNET_ADDRESSES.find((entry) => entry.address === normalized);
  if (builtin) return builtin;

  const existing = recordedTestnetAddresses.get(normalized);
  if (existing) return existing;

  const record: KnownTestnetAddress = { address: normalized, source, recordedAt };
  if (recordedTestnetAddresses.size >= MAX_RECORDED_TESTNET_ADDRESSES) {
    const oldest = recordedTestnetAddresses.keys().next();
    if (!oldest.done) recordedTestnetAddresses.delete(oldest.value);
  }
  recordedTestnetAddresses.set(normalized, record);
  return record;
}

/** Every testnet-only address we currently know about, built-ins included. */
export function getKnownTestnetAddresses(): KnownTestnetAddress[] {
  return [...BUILTIN_TESTNET_ADDRESSES, ...recordedTestnetAddresses.values()];
}

/**
 * True when `address` is on the testnet-only list. An explicit
 * `knownAddresses` list makes the check pure — handy for tests and for
 * callers that keep their own registry.
 */
export function isKnownTestnetOnlyAddress(
  address: unknown,
  knownAddresses: Iterable<KnownTestnetAddress | string> = getKnownTestnetAddresses()
): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;

  for (const entry of knownAddresses) {
    const candidate = typeof entry === 'string' ? normalizeAddress(entry) : normalizeAddress(entry?.address);
    if (candidate === normalized) return true;
  }
  return false;
}

/** Writes the recorded (non-builtin) addresses to AsyncStorage. */
export async function persistKnownTestnetAddresses(): Promise<boolean> {
  const payload = JSON.stringify([...recordedTestnetAddresses.values()]);
  try {
    await AsyncStorage.setItem(TESTNET_ADDRESS_STORAGE_KEY, payload);
    return true;
  } catch {
    // Best-effort. A failed write only costs us the warning next launch;
    // it must never block the address the user is trying to use.
    return false;
  }
}

/** Hydrates the in-memory registry from AsyncStorage. Safe to call twice. */
export async function loadKnownTestnetAddresses(): Promise<KnownTestnetAddress[]> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(TESTNET_ADDRESS_STORAGE_KEY);
  } catch {
    return getKnownTestnetAddresses();
  }

  if (!raw) return getKnownTestnetAddresses();

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry && typeof entry === 'object') {
          markTestnetAddress(
            entry.address,
            entry.source === 'api' || entry.source === 'friendbot' ? entry.source : 'api',
            typeof entry.recordedAt === 'string' ? entry.recordedAt : undefined
          );
        }
      }
    }
  } catch {
    // Corrupt payload — keep whatever is already in memory.
  }

  return getKnownTestnetAddresses();
}

/**
 * Drops every *recorded* address, keeping the built-ins. Test seam — and
 * the escape hatch for "forget my testnet wallets" style settings.
 */
export function resetKnownTestnetAddresses(): void {
  recordedTestnetAddresses.clear();
}

/** Returns true when `address` is a valid Stellar Ed25519 public key (G…). */
export function isValidStellarAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  return /^G[A-Z0-9]{55}$/.test(address);
}

export type AddressWarningCode = 'testnet-address-on-mainnet';

export interface AddressNetworkWarning {
  code: AddressWarningCode;
  network: 'mainnet';
  address: string;
  title: string;
  message: string;
  /** Always true: the user must confirm before we proceed. */
  requiresConfirmation: true;
  confirmLabel: string;
  cancelLabel: string;
  /** Provenance of the "testnet-only" claim, for logging/telemetry. */
  source: TestnetAddressSource;
}

export interface AddressCheckOptions {
  /** Overrides the env-derived network. */
  network?: StellarNetwork;
  /** Overrides `process.env` (Babel inlines `EXPO_PUBLIC_*` in tests). */
  env?: Record<string, string | undefined>;
  /** Overrides the testnet-only registry. */
  knownTestnetAddresses?: Iterable<KnownTestnetAddress | string>;
}

export interface AddressValidationResult {
  /** Canonical (trimmed, upper-cased) address, or `null` when invalid. */
  address: string | null;
  isValid: boolean;
  /** Hard failure — the value is not a Stellar public key at all. */
  error: string | null;
  /** Soft failure — valid key, but we know it only exists on testnet. */
  warning: AddressNetworkWarning | null;
}

const INVALID_ADDRESS_ERROR = 'Invalid Stellar address. Must start with G and be 56 characters.';

/**
 * The single entry point for address checks: hard format validation plus
 * the mainnet/testnet soft warning. `warning` is set only when the app is
 * configured for mainnet *and* the address is on the testnet-only list.
 */
export function validateStellarAddress(
  address: unknown,
  options: AddressCheckOptions = {}
): AddressValidationResult {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return { address: null, isValid: false, error: INVALID_ADDRESS_ERROR, warning: null };
  }

  const network = options.network ?? getStellarNetwork(options.env);
  const known = options.knownTestnetAddresses ?? getKnownTestnetAddresses();
  const flagged = knownTestnetRecord(normalized, known);

  if (network === 'testnet' || !flagged) {
    return { address: normalized, isValid: true, error: null, warning: null };
  }

  return {
    address: normalized,
    isValid: true,
    error: null,
    warning: buildTestnetAddressWarning(normalized, flagged.source),
  };
}

function knownTestnetRecord(
  normalized: string,
  knownAddresses: Iterable<KnownTestnetAddress | string>
): KnownTestnetAddress | null {
  for (const entry of knownAddresses) {
    const address = typeof entry === 'string' ? entry : entry?.address;
    if (normalizeAddress(address) === normalized) {
      return typeof entry === 'string' ? { address: normalized, source: 'api', recordedAt: '' } : entry;
    }
  }
  return null;
}

function buildTestnetAddressWarning(
  address: string,
  source: TestnetAddressSource
): AddressNetworkWarning {
  const origin =
    source === 'friendbot'
      ? 'This app pointed you at Friendbot to fund it'
      : source === 'api'
        ? 'Our backend has only ever seen it on testnet'
        : 'It is a placeholder key that no faucet can fund';

  return {
    code: 'testnet-address-on-mainnet',
    network: 'mainnet',
    address,
    title: 'Testnet address on mainnet',
    message:
      `GreenPay is configured for Stellar mainnet, but ${address} is a testnet-only account. ` +
      `${origin}. A mainnet transaction involving it will be rejected by the network and no ` +
      `funds will move. Continue only if you are certain this address also exists on mainnet.`,
    requiresConfirmation: true,
    confirmLabel: 'Send anyway',
    cancelLabel: 'Cancel',
    source,
  };
}

/**
 * Convenience wrapper: `null` when there is nothing to warn about.
 */
export function getAddressNetworkWarning(
  address: unknown,
  options: AddressCheckOptions = {}
): AddressNetworkWarning | null {
  return validateStellarAddress(address, options).warning;
}
