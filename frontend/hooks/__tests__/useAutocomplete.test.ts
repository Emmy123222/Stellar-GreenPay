import { act, renderHook } from "@testing-library/react";
import { useAutocomplete } from "../useAutocomplete";

describe("useAutocomplete", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("debounces the latest query and opens when results arrive", async () => {
    const fetcher = jest.fn(async (query: string) => [`${query}-result`]);
    const { result } = renderHook(() => useAutocomplete(fetcher, 300));

    act(() => result.current.setQuery("s"));
    act(() => jest.advanceTimersByTime(300));
    expect(fetcher).not.toHaveBeenCalled();

    act(() => result.current.setQuery("st"));
    act(() => jest.advanceTimersByTime(299));
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("st");
    expect(result.current.results).toEqual(["st-result"]);
    expect(result.current.isOpen).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("clears results below the minimum query length and handles fetch errors", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("offline"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useAutocomplete(fetcher, 100));

    act(() => result.current.setQuery("ab"));
    await act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledWith("ab");
    expect(result.current.loading).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(consoleError).toHaveBeenCalled();

    act(() => result.current.setQuery("a"));
    expect(result.current.results).toEqual([]);
    expect(result.current.isOpen).toBe(false);
  });
});
