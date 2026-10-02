import { useCallback, useSyncExternalStore } from 'react';

const WISHLIST_STORAGE_KEY = 'wishlist';
// Fired whenever this tab writes to the wishlist, so this tab's own
// subscribers re-render too (the native "storage" event only fires in
// *other* tabs/windows).
const WISHLIST_CHANGED_EVENT = 'greenpay:wishlist-changed';

// Module-level cache so repeated reads of unchanged localStorage content
// return the same array reference. useSyncExternalStore's getSnapshot must
// be referentially stable when the underlying data hasn't changed, or it
// will force re-renders indefinitely.
let cachedRaw: string | null | undefined;
let cachedWishlist: string[] = [];

function readWishlist(): string[] {
  const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
  if (raw === cachedRaw) return cachedWishlist;
  cachedRaw = raw;
  try {
    cachedWishlist = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to parse wishlist from localStorage', e);
    cachedWishlist = [];
  }
  return cachedWishlist;
}

function subscribeToWishlist(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(WISHLIST_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(WISHLIST_CHANGED_EVENT, callback);
  };
}

function getServerWishlistSnapshot(): string[] {
  return [];
}

/**
 * The wishlist lives in localStorage, which isn't available during SSR.
 * useSyncExternalStore is the React-recommended way to synchronize with an
 * external mutable store like this: it renders `getServerWishlistSnapshot()`
 * ([]) during SSR and initial hydration, then swaps to the real
 * localStorage-derived value right after mount — without a manual
 * effect + setState.
 */
export function useWishlist() {
  const wishlist = useSyncExternalStore(subscribeToWishlist, readWishlist, getServerWishlistSnapshot);

  const toggleWishlist = useCallback((projectId: string) => {
    const current = readWishlist();
    const updated = current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId];

    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event(WISHLIST_CHANGED_EVENT));
  }, []);

  return { wishlist, toggleWishlist, isInWishlist: (id: string) => wishlist.includes(id) };
}
