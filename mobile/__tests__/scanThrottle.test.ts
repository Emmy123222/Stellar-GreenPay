/**
 * __tests__/scanThrottle.test.ts
 *
 * Scan gate used by both QR scanners: 500ms interval + processing latch.
 */
import { createScanGate, SCAN_INTERVAL_MS } from '../utils/scanThrottle';

describe('createScanGate', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes a 500ms scan interval', () => {
    expect(SCAN_INTERVAL_MS).toBe(500);
  });

  it('accepts the first scan immediately', () => {
    const gate = createScanGate();
    expect(gate.tryAcquire()).toBe(true);
  });

  it('rejects scans that arrive sooner than the interval', () => {
    const gate = createScanGate();
    expect(gate.tryAcquire()).toBe(true);
    gate.release();

    // 499ms later — still inside the throttle window.
    (Date.now as jest.Mock).mockReturnValue(1_499);
    expect(gate.tryAcquire()).toBe(false);
    gate.release();

    // Exactly 500ms later — allowed again.
    (Date.now as jest.Mock).mockReturnValue(1_500);
    expect(gate.tryAcquire()).toBe(true);
  });

  it('latches while processing so duplicate frames are dropped', () => {
    const gate = createScanGate();
    expect(gate.tryAcquire()).toBe(true);

    // Even far past the interval, a latched gate stays closed.
    (Date.now as jest.Mock).mockReturnValue(9_999);
    expect(gate.tryAcquire()).toBe(false);

    gate.release();
    expect(gate.tryAcquire()).toBe(true);
  });

  it('reset() clears both the latch and the interval clock', () => {
    const gate = createScanGate();
    expect(gate.tryAcquire()).toBe(true);

    gate.reset();
    (Date.now as jest.Mock).mockReturnValue(1_000);
    expect(gate.tryAcquire()).toBe(true);
  });

  it('survives rapid-fire scans without admitting more than one per window', () => {
    const gate = createScanGate();
    let accepted = 0;

    for (let i = 0; i < 100; i += 1) {
      (Date.now as jest.Mock).mockReturnValue(1_000 + i * 5); // 200 scans/second
      if (gate.tryAcquire()) {
        accepted += 1;
        gate.release();
      }
    }

    // 100 frames over 500ms — at most one accepted per 500ms window.
    expect(accepted).toBe(1);
  });
});
