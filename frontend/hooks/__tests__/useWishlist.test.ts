import { act, renderHook } from "@testing-library/react";
import { useWishlist } from "../useWishlist";

describe("useWishlist", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it("persists wishlist changes across hook remounts", () => {
    const first = renderHook(() => useWishlist());

    act(() => first.result.current.toggleWishlist("project-1"));
    expect(first.result.current.wishlist).toEqual(["project-1"]);
    expect(first.result.current.isInWishlist("project-1")).toBe(true);
    first.unmount();

    const second = renderHook(() => useWishlist());
    expect(second.result.current.wishlist).toEqual(["project-1"]);
    expect(second.result.current.isInWishlist("project-1")).toBe(true);
  });

  it("remains usable when localStorage is unavailable", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    const { result } = renderHook(() => useWishlist());
    expect(() => {
      act(() => result.current.toggleWishlist("project-2"));
    }).not.toThrow();
    expect(result.current.wishlist).toEqual([]);
    expect(result.current.isInWishlist("project-2")).toBe(false);
  });
});
