/**
 * utils/cache.ts
 * AsyncStorage caching utility for offline support
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export async function getCachedData<T>(key: string): Promise<{ data: T; isStale: boolean } | null> {
  try {
    const cached = await AsyncStorage.getItem(key);
    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const isStale = Date.now() - entry.timestamp > CACHE_TTL_MS;
    return { data: entry.data, isStale };
  } catch {
    return null;
  }
}

export async function setCachedData<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    console.warn('Cache write failed:', error);
  }
}
