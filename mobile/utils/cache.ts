/**
 * utils/cache.ts
 * AsyncStorage caching utility for offline support with configurable TTL
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CACHE_TTL_MS: Record<string, number> = {
  projects: 5 * 60 * 1000,    // 5 minutes
  leaderboard: 1 * 60 * 1000, // 1 minute
  stats: 2 * 60 * 1000,       // 2 minutes
  default: 5 * 60 * 1000,     // 5 minutes default
};

export type CacheKeyType = 'projects' | 'leaderboard' | 'stats' | string;

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  timestamp?: number;
}

/**
 * Resolve the TTL in milliseconds for a given cache key or key type.
 */
export function getTTLForKey(key: string, customTtlMs?: number): number {
  if (typeof customTtlMs === 'number' && customTtlMs > 0) {
    return customTtlMs;
  }
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('leaderboard')) {
    return CACHE_TTL_MS.leaderboard;
  }
  if (lowerKey.includes('stats')) {
    return CACHE_TTL_MS.stats;
  }
  if (lowerKey.includes('project')) {
    return CACHE_TTL_MS.projects;
  }
  return CACHE_TTL_MS.default;
}

/**
 * Retrieve cached data. Returns null if missing, corrupt, or expired (Date.now() > expiresAt).
 */
export async function getCachedData<T>(
  key: string
): Promise<{ data: T; isStale: boolean; expiresAt: number } | null> {
  try {
    const cached = await AsyncStorage.getItem(key);
    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const now = Date.now();

    // Support both expiresAt and legacy timestamp entries
    const expiresAt =
      typeof entry.expiresAt === 'number'
        ? entry.expiresAt
        : typeof entry.timestamp === 'number'
        ? entry.timestamp + getTTLForKey(key)
        : 0;

    if (now > expiresAt) {
      return null;
    }

    return {
      data: entry.data,
      isStale: false,
      expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Store data in AsyncStorage with an expiry timestamp (expiresAt = Date.now() + TTL_MS).
 */
export async function setCachedData<T>(
  key: string,
  data: T,
  ttlMs?: number
): Promise<void> {
  try {
    const effectiveTtl = getTTLForKey(key, ttlMs);
    const expiresAt = Date.now() + effectiveTtl;
    const entry: CacheEntry<T> = {
      data,
      expiresAt,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    console.warn('Cache write failed:', error);
  }
}
