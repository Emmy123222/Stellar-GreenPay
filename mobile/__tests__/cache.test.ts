/**
 * __tests__/cache.test.ts
 * Tests for the AsyncStorage cache utility.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedData, setCachedData, getTTLForKey, CACHE_TTL_MS } from '../utils/cache';

const store = (AsyncStorage as any).__store as Record<string, string>;

describe('cache utility', () => {
  beforeEach(() => {
    // Clear the in-memory store without wiping mock implementations
    Object.keys(store).forEach((k) => delete store[k]);
    jest.clearAllMocks();
    // Re-apply implementations after clearAllMocks
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
      Promise.resolve(store[key] ?? null)
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    });
  });

  it('returns null when key is not in cache', async () => {
    expect(await getCachedData('missing')).toBeNull();
  });

  it('stores { data, expiresAt } and retrieves valid data', async () => {
    const before = Date.now();
    await setCachedData('key1', { foo: 'bar' });
    const after = Date.now();

    const result = await getCachedData<{ foo: string }>('key1');
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ foo: 'bar' });
    expect(result!.expiresAt).toBeGreaterThanOrEqual(before + CACHE_TTL_MS.default);
    expect(result!.expiresAt).toBeLessThanOrEqual(after + CACHE_TTL_MS.default);
  });

  it('returns null on cache read if Date.now() > expiresAt', async () => {
    const expired = JSON.stringify({ data: 'old', expiresAt: Date.now() - 1000 });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(expired);
    const result = await getCachedData<string>('old-key');
    expect(result).toBeNull();
  });

  it('uses configurable TTL per key type (projects: 5min, leaderboard: 1min, stats: 2min)', () => {
    expect(getTTLForKey('projects_list')).toBe(5 * 60 * 1000);
    expect(getTTLForKey('leaderboard_data')).toBe(1 * 60 * 1000);
    expect(getTTLForKey('stats_summary')).toBe(2 * 60 * 1000);
    expect(getTTLForKey('other_key')).toBe(5 * 60 * 1000);
  });

  it('supports custom TTL override parameter', async () => {
    const customTtl = 30 * 1000; // 30 seconds
    const before = Date.now();
    await setCachedData('custom-key', 'value', customTtl);

    const storedStr = store['custom-key'];
    expect(storedStr).toBeDefined();

    const storedObj = JSON.parse(storedStr);
    expect(storedObj.expiresAt).toBeGreaterThanOrEqual(before + customTtl);

    const result = await getCachedData<string>('custom-key');
    expect(result).not.toBeNull();
    expect(result!.data).toBe('value');
  });

  it('returns null on corrupt cache entry', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not-json{{{');
    expect(await getCachedData('corrupt')).toBeNull();
  });
});
