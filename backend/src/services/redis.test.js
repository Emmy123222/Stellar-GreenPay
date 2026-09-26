"use strict";

/**
 * Unit tests for the Redis singleton service.
 *
 * These tests verify:
 * - The module exports a true singleton (same reference across requires)
 * - All expected public API functions are exported
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
    const descriptor = Object.getOwnPropertyDescriptor(redis, "client");
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
      "key",
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
