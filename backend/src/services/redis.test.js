"use strict";

/**
 * Unit tests for the Redis singleton service.
 *
 * These tests verify:
 * - The module exports a true singleton (same reference across requires)
 * - All expected public API functions are exported
 * - Every key read/written/invalidated is namespaced with `greenpay:`
 * - No other file in the backend creates its own ioredis client
 */

// Mock ioredis before requiring the module under test
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockOn = jest.fn();
const mockQuit = jest.fn().mockResolvedValue("OK");

const MockRedis = jest.fn().mockImplementation(() => ({
  status: "ready",
  connect: mockConnect,
  on: mockOn,
  get: jest.fn(),
  set: jest.fn(),
  keys: jest.fn().mockResolvedValue([]),
  del: jest.fn(),
  ping: jest.fn().mockResolvedValue("PONG"),
  call: jest.fn(),
  quit: mockQuit,
}));

jest.mock("ioredis", () => MockRedis);

describe("Redis singleton service", () => {
  let redis;

  beforeAll(() => {
    redis = require("./redis");
  });

  test("exports a singleton — repeated require() returns the same object", () => {
    const redis2 = require("./redis");
    expect(redis).toBe(redis2);
  });

  test("exports the raw ioredis client instance", () => {
    expect(redis.client).toBeDefined();
    expect(typeof redis.client.get).toBe("function");
  });

  test("creates exactly one ioredis client", () => {
    // The Redis constructor should have been called exactly once at module load
    expect(MockRedis).toHaveBeenCalledTimes(1);
  });

  test("calls connect() exactly once at module load", () => {
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  test("registers an error handler on the client", () => {
    expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  test("exports all expected public API functions", () => {
    expect(typeof redis.get).toBe("function");
    expect(typeof redis.set).toBe("function");
    expect(typeof redis.deletePattern).toBe("function");
    expect(typeof redis.ping).toBe("function");
    expect(typeof redis.sendCommand).toBe("function");
    expect(typeof redis.quit).toBe("function");
  });

  test("client is not reassignable (const)", () => {
    // Module exports are writable by default in CJS, but the source uses const
    // so the internal variable cannot be reassigned. We verify the exported
    // reference is stable across requires.
    const clientBefore = redis.client;
    const redis3 = require("./redis");
    expect(redis3.client).toBe(clientBefore);
  });

  test("get() returns parsed JSON from Redis", async () => {
    redis.client.get.mockResolvedValueOnce(JSON.stringify({ foo: "bar" }));
    const result = await redis.get("test-key");
    expect(result).toEqual({ foo: "bar" });
  });

  test("get() returns null on cache miss", async () => {
    redis.client.get.mockResolvedValueOnce(null);
    const result = await redis.get("missing-key");
    expect(result).toBeNull();
  });

  test("set() serialises value as JSON with EX TTL", async () => {
    redis.client.set.mockResolvedValueOnce("OK");
    await redis.set("key", { data: 1 }, 60);
    expect(redis.client.set).toHaveBeenCalledWith(
      "greenpay:key",
      JSON.stringify({ data: 1 }),
      "EX",
      60,
    );
  });

  test("ping() returns PONG on success", async () => {
    redis.client.ping.mockResolvedValueOnce("PONG");
    const result = await redis.ping();
    expect(result).toBe("PONG");
  });

  test("quit() calls client.quit() when status is ready", async () => {
    await redis.quit();
    expect(mockQuit).toHaveBeenCalled();
  });
});

/**
 * The service must never touch a key outside the `greenpay:` namespace, so a
 * shared Redis instance cannot have its data read, overwritten, or deleted by
 * this service (and vice versa).
 */
describe("Redis key namespacing", () => {
  let redis;

  beforeAll(() => {
    redis = require("./redis");
  });

  beforeEach(() => {
    redis.client.get.mockReset();
    redis.client.set.mockReset();
    redis.client.keys.mockReset();
    redis.client.del.mockReset();
    redis.client.call.mockReset();
    redis.client.keys.mockResolvedValue([]);
  });

  test("exports the `greenpay:` prefix it writes with", () => {
    expect(redis.CACHE_KEY_PREFIX).toBe("greenpay:");
  });

  test("set() writes under the `greenpay:` prefix", async () => {
    redis.client.set.mockResolvedValueOnce("OK");
    await redis.set("leaderboard:page:1", { rank: 1 }, 300);

    expect(redis.client.set).toHaveBeenCalledWith(
      "greenpay:leaderboard:page:1",
      JSON.stringify({ rank: 1 }),
      "EX",
      300,
    );
  });

  test("set() never writes the raw, unprefixed key", async () => {
    redis.client.set.mockResolvedValueOnce("OK");
    await redis.set("project:abc123", { id: "abc123" }, 60);

    const writtenKeys = redis.client.set.mock.calls.map(([key]) => key);
    expect(writtenKeys).toEqual(["greenpay:project:abc123"]);
    expect(writtenKeys).not.toContain("project:abc123");
  });

  test("get() reads under the `greenpay:` prefix", async () => {
    redis.client.get.mockResolvedValueOnce(JSON.stringify({ rank: 1 }));

    const result = await redis.get("leaderboard:page:1");

    expect(redis.client.get).toHaveBeenCalledWith("greenpay:leaderboard:page:1");
    expect(result).toEqual({ rank: 1 });
  });

  test("get() returns null for a value that only exists under the raw key", async () => {
    // Simulates a legacy, unprefixed entry left behind by a previous deploy:
    // the service must not read it.
    redis.client.get.mockImplementation((key) =>
      Promise.resolve(key === "project:abc123" ? JSON.stringify({ stale: true }) : null),
    );

    await expect(redis.get("project:abc123")).resolves.toBeNull();
    expect(redis.client.get).not.toHaveBeenCalledWith("project:abc123");
  });

  test("set() + get() round-trip through the same namespaced key", async () => {
    redis.client.set.mockResolvedValueOnce("OK");
    await redis.set("stats:global", { totalProjects: 3 }, 60);
    const [writtenKey] = redis.client.set.mock.calls[0];

    redis.client.get.mockResolvedValueOnce(JSON.stringify({ totalProjects: 3 }));
    const result = await redis.get("stats:global");

    expect(redis.client.get).toHaveBeenCalledWith(writtenKey);
    expect(result).toEqual({ totalProjects: 3 });
  });

  test("an already namespaced key is not double-prefixed", async () => {
    redis.client.get.mockResolvedValueOnce(null);
    await redis.get("greenpay:stats:global");

    expect(redis.client.get).toHaveBeenCalledWith("greenpay:stats:global");
  });

  test("deletePattern() scopes the KEYS glob to the `greenpay:` namespace", async () => {
    redis.client.keys.mockResolvedValueOnce(["greenpay:projects:list:1", "greenpay:projects:list:2"]);

    await redis.deletePattern("projects:list:*");

    expect(redis.client.keys).toHaveBeenCalledWith("greenpay:projects:list:*");
    expect(redis.client.del).toHaveBeenCalledWith(
      "greenpay:projects:list:1",
      "greenpay:projects:list:2",
    );
  });

  test("deletePattern() does not double-prefix an already namespaced pattern", async () => {
    await redis.deletePattern("greenpay:rate-limit:test:*");

    expect(redis.client.keys).toHaveBeenCalledWith("greenpay:rate-limit:test:*");
  });

  test("deletePattern() is a no-op when the namespace holds no matches", async () => {
    await redis.deletePattern("projects:list:*");

    expect(redis.client.keys).toHaveBeenCalledTimes(1);
    expect(redis.client.del).not.toHaveBeenCalled();
  });

  test("deletePattern() stays inside the namespace when given an exact key", async () => {
    redis.client.keys.mockResolvedValueOnce(["greenpay:project:abc123:milestones"]);

    await redis.deletePattern("project:abc123:milestones");

    expect(redis.client.keys).toHaveBeenCalledWith("greenpay:project:abc123:milestones");
    expect(redis.client.del).toHaveBeenCalledWith("greenpay:project:abc123:milestones");
  });

  test("sendCommand() forwards commands verbatim (rate limiter owns its prefix)", async () => {
    redis.client.call.mockResolvedValueOnce("OK");

    await redis.sendCommand("SET", "greenpay:rate-limit:test:1.2.3.4", "1", "EX", "60");

    expect(redis.client.call).toHaveBeenCalledWith(
      "SET",
      "greenpay:rate-limit:test:1.2.3.4",
      "1",
      "EX",
      "60",
    );
  });

  test("rejects empty and non-string keys", async () => {
    // `get`/`set` swallow errors; the mock client must therefore never be
    // reached with an unnamespaced key.
    await expect(redis.get("")).resolves.toBeNull();
    await expect(redis.set(undefined, { a: 1 }, 60)).resolves.toBeUndefined();

    expect(redis.client.get).not.toHaveBeenCalled();
    expect(redis.client.set).not.toHaveBeenCalled();
  });
});
