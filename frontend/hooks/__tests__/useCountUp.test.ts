import { act, renderHook } from "@testing-library/react";
import { useCountUp } from "../useCountUp";

describe("useCountUp", () => {
  let intersectionCallback: IntersectionObserverCallback;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IntersectionObserver = class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
      takeRecords = jest.fn(() => []);
      root = null;
      rootMargin = "0px";
      thresholds = [0.1];
    } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("animates to the target after the element becomes visible", () => {
    const { result } = renderHook(() => useCountUp(100, 200));

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    act(() => jest.advanceTimersByTime(250));
    expect(result.current.count).toBe(100);
  });

  it("respects the configured duration", () => {
    const { result } = renderHook(() => useCountUp(100, 400));

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    act(() => jest.advanceTimersByTime(200));
    expect(result.current.count).toBeLessThan(100);

    act(() => jest.advanceTimersByTime(250));
    expect(result.current.count).toBe(100);
  });
});
