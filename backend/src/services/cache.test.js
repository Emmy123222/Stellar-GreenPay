"use strict";

/**
 * Unit tests for the in-memory TTL cache (`services/cache.js`).
 *
 * Focus: every key is stored under the `greenpay:` namespace, so a bare key
 * never resolves and two services sharing a store cannot collide.
 */

const TTL_MS = 60_000;

/** Fresh module instance per test — the cache is a module-level singleton. */
function freshCache() {
  jest.resetModules();
  // eslint-disable-next-line global-require
  return require("./cache");
}

describe("services/cache — key namespacing", () => {
  let cache;

  beforeEach(() => {
    cache = freshCache();
  });

  test("stores the value under the `greenpay:` prefixed key", () => {
    cache.set("leaderboard:page:1", { rank: 1 }, TTL_MS);

    expect(cache.keys()).toEqual(["greenpay:leaderboard:page:1"]);
    expect(cache.get("greenpay:leaderboard:page:1")).toEqual({ rank: 1 });
  });

  test("returns null for the raw (unprefixed) key", () => {
    cache.set("project:abc123", { id: "abc123" }, TTL_MS);

    // The bare key is never an entry in the store — the value only exists
    // under `greenpay:project:abc123`, so nothing outside this namespace can
    // collide with it.
    expect(cache.keys()).toEqual(["greenpay:project:abc123"]);
    expect(cache.keys()).not.toContain("project:abc123");
  });

  test("returns null for a key that was never cached", () => {
    expect(cache.get("leaderboard:page:1")).toBeNull();
  });

  test("does not double-prefix an explicitly namespaced key", () => {
    cache.set("greenpay:project:abc123", { id: "abc123" }, TTL_MS);

    expect(cache.keys()).toEqual(["greenpay:project:abc123"]);
    expect(cache.get("greenpay:project:abc123")).toEqual({ id: "abc123" });
    expect(cache.get("greenpay:greenpay:project:abc123")).toBeNull();
  });

  test("a key that collides with another service's naming is kept in our namespace", () => {
    // `project:abc123` is a plausible key for an unrelated service sharing the
    // same store; ours is written as `greenpay:project:abc123` and the two can
    // never overwrite each other.
    cache.set("project:abc123", { id: "abc123" }, TTL_MS);

    expect(cache.get("project:abc123")).toEqual({ id: "abc123" });
    expect(cache.keys()).toEqual(["greenpay:project:abc123"]);
  });

  test("set() returns the stored value", () => {
    expect(cache.set("stats:global", { totalProjects: 3 }, TTL_MS)).toEqual({ totalProjects: 3 });
  });

  test("del() removes the namespaced entry and reports whether it existed", () => {
    cache.set("jobs:stats", { escrow: 1 }, TTL_MS);

    expect(cache.del("jobs:stats")).toBe(true);
    expect(cache.get("greenpay:jobs:stats")).toBeNull();
    expect(cache.del("jobs:stats")).toBe(false);
  });

  test("keys() returns namespaced keys only", () => {
    cache.set("projects:list:20:1:recent", ["a"], TTL_MS);
    cache.set("stats:global", {}, TTL_MS);

    const all = cache.keys();
    expect(all).toEqual(["greenpay:projects:list:20:1:recent", "greenpay:stats:global"]);
    expect(all.every((key) => key.startsWith("greenpay:"))).toBe(true);
  });
});

describe("services/cache — TTL behaviour", () => {
  let cache;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = freshCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns the value before the TTL elapses", () => {
    cache.set("impact:project:1", { kg: 10 }, 5_000);

    jest.advanceTimersByTime(4_999);
    expect(cache.get("impact:project:1")).toEqual({ kg: 10 });
  });

  test("returns null and prunes the entry once the TTL elapses", () => {
    cache.set("impact:project:1", { kg: 10 }, 5_000);

    jest.advanceTimersByTime(5_000);
    expect(cache.get("impact:project:1")).toBeNull();
    expect(cache.keys()).not.toContain("greenpay:impact:project:1");
  });

  test("keys() prunes expired entries so the snapshot only lists live keys", () => {
    cache.set("impact:project:2", { kg: 20 }, 1_000);
    cache.set("impact:project:3", { kg: 30 }, 60_000);

    jest.advanceTimersByTime(1_000);
    expect(cache.keys()).toEqual(["greenpay:impact:project:3"]);
  });

  test("rejects empty and non-string keys", () => {
    expect(() => cache.set("", "value", TTL_MS)).toThrow(TypeError);
    expect(() => cache.get(undefined)).toThrow(TypeError);
  });
});
