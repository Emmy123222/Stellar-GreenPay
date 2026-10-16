"use strict";

/**
 * Unit tests for the shared cache key namespace helper.
 *
 * The whole point of `utils/cacheKeys.js` is that a bare key such as
 * `project:abc123` can never be written to (or read from) a store without a
 * `greenpay:` prefix, so these tests pin that guarantee down.
 */

const {
  CACHE_NAMESPACE,
  CACHE_KEY_PREFIX,
  namespacedKey,
  isNamespacedKey,
} = require("./cacheKeys");

describe("cache key namespace constants", () => {
  test("namespace is `greenpay` and the prefix is `greenpay:`", () => {
    expect(CACHE_NAMESPACE).toBe("greenpay");
    expect(CACHE_KEY_PREFIX).toBe("greenpay:");
  });
});

describe("namespacedKey", () => {
  test.each([
    ["leaderboard:page:1", "greenpay:leaderboard:page:1"],
    ["project:abc123", "greenpay:project:abc123"],
    ["stats:global", "greenpay:stats:global"],
    ["jobs:stats", "greenpay:jobs:stats"],
    ["projects:trending:20", "greenpay:projects:trending:20"],
    ["/api/impact/project/abc", "greenpay:/api/impact/project/abc"],
  ])("%s -> %s", (input, expected) => {
    expect(namespacedKey(input)).toBe(expected);
  });

  test("keeps wildcard patterns intact and namespaces the front", () => {
    expect(namespacedKey("projects:list:*")).toBe("greenpay:projects:list:*");
    expect(namespacedKey("project:*:milestones")).toBe("greenpay:project:*:milestones");
  });

  test("is idempotent — an already namespaced key is not double-prefixed", () => {
    expect(namespacedKey("greenpay:project:abc123")).toBe("greenpay:project:abc123");
    expect(namespacedKey("greenpay:projects:list:*")).toBe("greenpay:projects:list:*");
    expect(namespacedKey(namespacedKey("project:abc123"))).toBe("greenpay:project:abc123");
  });

  test("is a no-op for a key that only looks like the namespace", () => {
    // `greenpayfoo` starts with the namespace name but not the prefix, so it
    // must still receive the separator.
    expect(namespacedKey("greenpayfoo")).toBe("greenpay:greenpayfoo");
  });

  test.each([
    ["", "empty string"],
    [null, "null"],
    [undefined, "undefined"],
    [42, "number"],
    [{}, "object"],
  ])("rejects %p (%s)", (input) => {
    expect(() => namespacedKey(input)).toThrow(TypeError);
  });
});

describe("isNamespacedKey", () => {
  test.each([
    ["greenpay:project:abc123", true],
    ["greenpay:", true],
    ["project:abc123", false],
    ["greenpayfoo", false],
    [undefined, false],
    [123, false],
  ])("%p -> %s", (input, expected) => {
    expect(isNamespacedKey(input)).toBe(expected);
  });
});
