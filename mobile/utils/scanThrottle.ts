/**
 * utils/scanThrottle.ts
 *
 * Shared scan gate for the QR scanners.
 *
 * Continuous camera previews on low-end Android devices fire `onBarcodeScanned`
 * many times per second. React state updates driven by every event cause frame
 * drops and UI freezes, so we:
 *
 *   1. accept at most one scan per `SCAN_INTERVAL_MS` (500ms), and
 *   2. latch the gate while a scan is being processed so a code still in view
 *      cannot trigger a second, duplicate action.
 *
 * The gate is a plain object driven by refs, so it never triggers a re-render
 * by itself.
 */

export const SCAN_INTERVAL_MS = 500;

export interface ScanGate {
  /** Returns true when a new scan may be processed right now. */
  tryAcquire(now?: number): boolean;
  /** Unlatches the gate so the next scan can be processed. */
  release(): void;
  /** Clears both the latch and the interval clock (used on rescan). */
  reset(): void;
}

export function createScanGate(intervalMs: number = SCAN_INTERVAL_MS): ScanGate {
  let lastAcceptedAt = 0;
  let processing = false;

  return {
    tryAcquire(now: number = Date.now()): boolean {
      if (processing) return false;
      if (now - lastAcceptedAt < intervalMs) return false;
      lastAcceptedAt = now;
      processing = true;
      return true;
    },
    release(): void {
      processing = false;
    },
    reset(): void {
      processing = false;
      lastAcceptedAt = 0;
    },
  };
}
