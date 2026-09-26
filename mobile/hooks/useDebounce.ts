/**
 * hooks/useDebounce.ts
 *
 * Returns a copy of `value` that only updates after `delayMs` milliseconds
 * have passed without the value changing again.
 *
 * Used by the projects search box (#1129) so a burst of keystrokes results in
 * a single network request instead of one request per character.
 */
import { useEffect, useState } from 'react';

export const DEFAULT_DEBOUNCE_MS = 300;

export function useDebounce<T>(value: T, delayMs: number = DEFAULT_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export default useDebounce;
