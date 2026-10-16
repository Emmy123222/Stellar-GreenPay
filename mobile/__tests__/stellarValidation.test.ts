/**
 * __tests__/stellarValidation.test.ts
 * Unit tests for the Stellar address validation utility.
 *
 * Covers: valid G-address, wrong prefix, wrong length, bad characters,
 * null/undefined/number inputs, network resolution from env, and the
 * mainnet soft warning for testnet-only (e.g. Friendbot) addresses
 * (issue #1126).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAddressNetworkWarning,
  getKnownTestnetAddresses,
  getStellarNetwork,
  isKnownTestnetOnlyAddress,
  isMainnet,
  isValidStellarAddress,
  loadKnownTestnetAddresses,
  markTestnetAddress,
  persistKnownTestnetAddresses,
  resetKnownTestnetAddresses,
  TESTNET_ADDRESS_STORAGE_KEY,
  validateStellarAddress,
  ZEROED_PUBLIC_KEY,
} from '../utils/stellarValidation';

const VALID_ADDRESS = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP';

describe('isValidStellarAddress', () => {
  it('accepts a well-formed 56-character G-address', () => {
    expect(isValidStellarAddress(VALID_ADDRESS)).toBe(true);
  });

  it('accepts an address composed entirely of uppercase letters after G', () => {
    const allLetters = `G${'A'.repeat(55)}`;
    expect(isValidStellarAddress(allLetters)).toBe(true);
  });

  it('accepts an address containing uppercase letters and digits', () => {
    const mixed = `G${'A'.repeat(50)}12345`;
    expect(isValidStellarAddress(mixed)).toBe(true);
  });

  it('rejects an address starting with a lowercase g', () => {
    const lower = VALID_ADDRESS.toLowerCase();
    expect(isValidStellarAddress(lower)).toBe(false);
  });

  it('rejects an address that starts with a character other than G', () => {
    expect(isValidStellarAddress(`S${'A'.repeat(55)}`)).toBe(false);
    expect(isValidStellarAddress(`X${'A'.repeat(55)}`)).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(isValidStellarAddress(`G${'A'.repeat(54)}`)).toBe(false);
  });

  it('rejects an address that is too long', () => {
    expect(isValidStellarAddress(`G${'A'.repeat(56)}`)).toBe(false);
  });

  it('rejects an address containing lowercase letters', () => {
    expect(isValidStellarAddress(`G${'a'.repeat(55)}`)).toBe(false);
  });

  it('rejects an address containing spaces', () => {
    expect(isValidStellarAddress(`G${' '.repeat(55)}`)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidStellarAddress(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidStellarAddress(undefined)).toBe(false);
  });

  it('rejects a number', () => {
    expect(isValidStellarAddress(12345)).toBe(false);
  });

  it('rejects an object', () => {
    expect(isValidStellarAddress({})).toBe(false);
  });
});

/**
 * Issue #1126 — a valid G-address can still be a testnet-only account.
 * These suites pin the *soft* mainnet warning: the address stays valid,
 * the caller gets a `requiresConfirmation` warning instead of a block.
 */
describe('getStellarNetwork', () => {
  it('reads EXPO_PUBLIC_STELLAR_NETWORK (the Expo-inlined build var)', () => {
    expect(getStellarNetwork({ EXPO_PUBLIC_STELLAR_NETWORK: 'mainnet' })).toBe('mainnet');
    expect(getStellarNetwork({ EXPO_PUBLIC_STELLAR_NETWORK: 'testnet' })).toBe('testnet');
  });

  it('falls back to STELLAR_NETWORK for a shared .env file', () => {
    expect(getStellarNetwork({ STELLAR_NETWORK: 'mainnet' })).toBe('mainnet');
    expect(getStellarNetwork({ STELLAR_NETWORK: 'testnet' })).toBe('testnet');
  });

  it('prefers EXPO_PUBLIC_STELLAR_NETWORK when both are set', () => {
    expect(
      getStellarNetwork({
        EXPO_PUBLIC_STELLAR_NETWORK: 'mainnet',
        STELLAR_NETWORK: 'testnet',
      })
    ).toBe('mainnet');
  });

  it('normalises case, padding and the "public" alias', () => {
    expect(getStellarNetwork({ EXPO_PUBLIC_STELLAR_NETWORK: '  MainNet \n' })).toBe('mainnet');
    expect(getStellarNetwork({ EXPO_PUBLIC_STELLAR_NETWORK: 'PUBLIC' })).toBe('mainnet');
  });

  it('defaults to testnet when unset or unrecognised', () => {
    expect(getStellarNetwork({})).toBe('testnet');
    expect(getStellarNetwork({ EXPO_PUBLIC_STELLAR_NETWORK: '' })).toBe('testnet');
    expect(getStellarNetwork({ EXPO_PUBLIC_STELLAR_NETWORK: 'futurenet' })).toBe('testnet');
  });

  it('reads process.env when no override is supplied', () => {
    // Babel inlines `process.env.EXPO_PUBLIC_*` at transform time, so under
    // Jest the var is `undefined` and the safe testnet default applies.
    // This is the branch production builds take.
    expect(getStellarNetwork()).toBe('testnet');
    expect(isMainnet()).toBe(false);
  });

  it('reports mainnet through isMainnet', () => {
    expect(isMainnet({ EXPO_PUBLIC_STELLAR_NETWORK: 'mainnet' })).toBe(true);
    expect(isMainnet({ EXPO_PUBLIC_STELLAR_NETWORK: 'testnet' })).toBe(false);
  });
});

describe('testnet-only address registry', () => {
  const store = (AsyncStorage as unknown as { __store: Record<string, string> }).__store;

  beforeEach(() => {
    resetKnownTestnetAddresses();
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it('records a valid address and ignores anything that is not one', () => {
    expect(markTestnetAddress(VALID_ADDRESS)).toEqual({
      address: VALID_ADDRESS,
      source: 'friendbot',
      recordedAt: expect.any(String),
    });
    expect(markTestnetAddress('not-an-address')).toBeNull();
    expect(markTestnetAddress(null)).toBeNull();
  });

  it('is idempotent — a second mark does not duplicate the entry', () => {
    markTestnetAddress(VALID_ADDRESS);
    const second = markTestnetAddress(VALID_ADDRESS);
    expect(getKnownTestnetAddresses().filter((e) => e.address === VALID_ADDRESS)).toHaveLength(1);
    expect(second?.source).toBe('friendbot');
  });

  it('normalises pasted whitespace/case on both sides of a lookup', () => {
    markTestnetAddress(VALID_ADDRESS);
    expect(isKnownTestnetOnlyAddress(`  ${VALID_ADDRESS.toLowerCase()}  `)).toBe(true);
    expect(isKnownTestnetOnlyAddress(`G${'B'.repeat(55)}`)).toBe(false);
    expect(isKnownTestnetOnlyAddress('nope')).toBe(false);
  });

  it('keeps built-ins immutable — marking one returns the built-in record', () => {
    const record = markTestnetAddress(ZEROED_PUBLIC_KEY, 'friendbot');
    expect(record?.source).toBe('builtin');
    expect(isKnownTestnetOnlyAddress(ZEROED_PUBLIC_KEY)).toBe(true);
  });

  it('clears recorded entries on reset but keeps the built-ins', () => {
    markTestnetAddress(VALID_ADDRESS);
    resetKnownTestnetAddresses();
    expect(isKnownTestnetOnlyAddress(VALID_ADDRESS)).toBe(false);
    expect(isKnownTestnetOnlyAddress(ZEROED_PUBLIC_KEY)).toBe(true);
  });

  it('survives a persist/load round trip', async () => {
    markTestnetAddress(VALID_ADDRESS, 'friendbot', '2024-01-01T00:00:00.000Z');
    expect(await persistKnownTestnetAddresses()).toBe(true);
    expect(store[TESTNET_ADDRESS_STORAGE_KEY]).toContain(VALID_ADDRESS);

    resetKnownTestnetAddresses();
    expect(isKnownTestnetOnlyAddress(VALID_ADDRESS)).toBe(false);

    const loaded = await loadKnownTestnetAddresses();
    expect(isKnownTestnetOnlyAddress(VALID_ADDRESS)).toBe(true);
    expect(loaded.find((e) => e.address === VALID_ADDRESS)?.source).toBe('friendbot');
  });

  it('tolerates a corrupt stored payload', async () => {
    store[TESTNET_ADDRESS_STORAGE_KEY] = '{not json';
    await expect(loadKnownTestnetAddresses()).resolves.toBeDefined();
    store[TESTNET_ADDRESS_STORAGE_KEY] = '{"not":"an array"}';
    await expect(loadKnownTestnetAddresses()).resolves.toBeDefined();
    expect(isKnownTestnetOnlyAddress(ZEROED_PUBLIC_KEY)).toBe(true);
  });

  it('reports failure instead of throwing when the write is rejected', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    expect(await persistKnownTestnetAddresses()).toBe(false);
  });
});

describe('validateStellarAddress — mainnet warning for testnet addresses (issue #1126)', () => {
  const MAINNET = { EXPO_PUBLIC_STELLAR_NETWORK: 'mainnet' };
  const TESTNET = { EXPO_PUBLIC_STELLAR_NETWORK: 'testnet' };

  beforeEach(() => {
    resetKnownTestnetAddresses();
  });

  it('warns on mainnet for a Friendbot-generated address, but keeps it valid', () => {
    // The app just handed this key to Friendbot to be funded on testnet.
    markTestnetAddress(VALID_ADDRESS, 'friendbot');

    const result = validateStellarAddress(VALID_ADDRESS, { env: MAINNET });

    // Soft warning: valid format, no hard error, caller must confirm.
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.address).toBe(VALID_ADDRESS);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toMatchObject({
      code: 'testnet-address-on-mainnet',
      network: 'mainnet',
      address: VALID_ADDRESS,
      source: 'friendbot',
      requiresConfirmation: true,
      confirmLabel: 'Send anyway',
    });
    expect(result.warning!.message).toContain(VALID_ADDRESS);
    expect(result.warning!.message).toContain('mainnet');
    expect(result.warning!.message).toContain('Friendbot');
  });

  it('exposes the same warning through getAddressNetworkWarning', () => {
    markTestnetAddress(VALID_ADDRESS, 'friendbot');
    const warning = getAddressNetworkWarning(VALID_ADDRESS, { env: MAINNET });
    expect(warning?.code).toBe('testnet-address-on-mainnet');
    expect(warning?.requiresConfirmation).toBe(true);
  });

  it('does not warn on testnet for the same address', () => {
    markTestnetAddress(VALID_ADDRESS, 'friendbot');
    const result = validateStellarAddress(VALID_ADDRESS, { env: TESTNET });
    expect(result.isValid).toBe(true);
    expect(result.warning).toBeNull();
  });

  it('does not warn on mainnet for an address we have no testnet record for', () => {
    const result = validateStellarAddress(VALID_ADDRESS, { env: MAINNET });
    expect(result.isValid).toBe(true);
    expect(result.warning).toBeNull();
    expect(getAddressNetworkWarning(VALID_ADDRESS, { env: MAINNET })).toBeNull();
  });

  it('warns on mainnet for the built-in zeroed placeholder key', () => {
    const warning = getAddressNetworkWarning(ZEROED_PUBLIC_KEY, { env: MAINNET });
    expect(warning?.source).toBe('builtin');
  });

  it('matches a caller-supplied registry without touching global state', () => {
    const result = validateStellarAddress(VALID_ADDRESS, {
      env: MAINNET,
      knownTestnetAddresses: [{ address: VALID_ADDRESS.toLowerCase(), source: 'api', recordedAt: '' }],
    });
    expect(result.warning).toMatchObject({ source: 'api' });
    expect(isKnownTestnetOnlyAddress(VALID_ADDRESS)).toBe(false);
  });

  it('accepts an explicit network option over the env', () => {
    markTestnetAddress(VALID_ADDRESS, 'friendbot');
    expect(validateStellarAddress(VALID_ADDRESS, { network: 'testnet' }).warning).toBeNull();
    expect(validateStellarAddress(VALID_ADDRESS, { network: 'mainnet' }).warning).not.toBeNull();
  });

  it('returns a hard error (never a warning) for an invalid address on mainnet', () => {
    const result = validateStellarAddress('G123', { env: MAINNET });
    expect(result.isValid).toBe(false);
    expect(result.address).toBeNull();
    expect(result.warning).toBeNull();
    expect(result.error).toBe('Invalid Stellar address. Must start with G and be 56 characters.');
  });
});

