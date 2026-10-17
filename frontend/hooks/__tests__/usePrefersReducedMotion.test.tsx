import { act, renderHook } from "@testing-library/react";
import { useCountUp } from "../useCountUp";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";

function createMediaQueryList(initialMatches = false) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    matches: initialMatches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: jest.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: jest.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    addListener: jest.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeListener: jest.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatchEvent: jest.fn(() => true),
    setMatches(matches: boolean) {
      this.matches = matches;
      const event = { matches, media: this.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };

  return mediaQueryList as unknown as MediaQueryList & { setMatches(matches: boolean): void };
}

describe("usePrefersReducedMotion", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    jest.restoreAllMocks();
  });

  it("tracks changes to the reduced-motion media query", () => {
    const mediaQueryList = createMediaQueryList();
    window.matchMedia = jest.fn().mockReturnValue(mediaQueryList);

    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => mediaQueryList.setMatches(true));
    expect(result.current).toBe(true);

    act(() => mediaQueryList.setMatches(false));
    expect(result.current).toBe(false);

    unmount();
    expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("completes a count immediately when reduced motion is enabled", () => {
    const mediaQueryList = createMediaQueryList();
    window.matchMedia = jest.fn().mockReturnValue(mediaQueryList);
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = jest.fn((_callback: FrameRequestCallback) => 1);
    window.cancelAnimationFrame = jest.fn();

    try {
      const { result } = renderHook(() => useCountUp(250, 2000));
      expect(result.current.count).toBe(0);

      act(() => mediaQueryList.setMatches(true));
      expect(result.current.count).toBe(250);
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});
