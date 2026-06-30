/**
 * __tests__/cache.test.ts
 * Tests for the AsyncStorage cache utility.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedData, setCachedData } from '../utils/cache';

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

  it('stores and retrieves data', async () => {
    await setCachedData('key1', { foo: 'bar' });
    const result = await getCachedData<{ foo: string }>('key1');
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ foo: 'bar' });
  });

  it('isStale is false for fresh data', async () => {
    await setCachedData('key2', [1, 2, 3]);
    const result = await getCachedData<number[]>('key2');
    expect(result!.isStale).toBe(false);
  });

  it('isStale is true for expired data (>10 min)', async () => {
    const expired = JSON.stringify({ data: 'old', timestamp: Date.now() - 11 * 60 * 1000 });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(expired);
    const result = await getCachedData<string>('old-key');
    expect(result!.isStale).toBe(true);
    expect(result!.data).toBe('old');
  });

  it('returns null on corrupt cache entry', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not-json{{{');
    expect(await getCachedData('corrupt')).toBeNull();
  });
});
