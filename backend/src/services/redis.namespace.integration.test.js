"use strict";

/**
 * src/services/redis.namespace.integration.test.js
 * End-to-end proof that the Redis cache service really writes inside the
 * `greenpay:` namespace, verified against a live Redis instance.
 *
 * The unit tests in `redis.test.js` assert which commands the service issues;
 * this suite asserts the *resulting keys* in Redis:
 *   - a value written by the service is readable at `greenpay:<key>`
 *   - the bare `<key>` is never written and never read
 *   - invalidation (`deletePattern`) cannot reach another namespace
 *
 * Uses `REDIS_URL` when set (both CI jobs provide a Redis service container)
 * and otherwise starts a throwaway `redis:7-alpine` container. When neither is
 * available the suite is skipped, so local runs without Redis stay green.
 */

let GenericContainer;
try {
  ({ GenericContainer } = require("testcontainers"));
} catch {
  // testcontainers is optional — a reachable REDIS_URL alone is enough.
}

const RUN_ID = `ns-test:${process.pid}:${Date.now()}`;

/** Cache key unique to this run (and to the test using it). */
const key = (name) => `test:${RUN_ID}:${name}`;

/**
 * Keys owned by an unrelated service sharing the same Redis instance. They
 * have the same *shape* as our own keys, so a missing namespace would make
 * them collide with (or be hit by) our reads and invalidations.
 */
const foreignKey = (name) => name;

const LIST_KEYS = [key("projects:list:1"), key("projects:list:2")];
const FOREIGN_LIST_KEY = foreignKey("projects:list:9");
const LEGACY_KEY = key("legacy:leaderboard");
const ROUNDTRIP_KEY = key("roundtrip:leaderboard");
const PREFIXED_KEY = key("prefixed:leaderboard");
const WILDCARD_KEY = "leaderboard:page:1";
const FOREIGN_WILDCARD_KEY = foreignKey("leaderboard:shared-by-another-service");

const redisServicePath = "./redis";
const { CACHE_KEY_PREFIX } = require("../utils/cacheKeys");

let redisService;
let rawClient;
let container;
let originalRedisUrl;
let redisAvailable = false;

/** Raw, un-namespaced client used to inspect what actually landed in Redis. */
function openRawClient() {
  const Redis = require("ioredis");
  if (container) {
    return new Redis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`);
  }
  return new Redis(process.env.REDIS_URL);
}

const describeWithRedis = process.env.REDIS_URL || GenericContainer ? describe : describe.skip;

describeWithRedis("Redis cache namespace (live Redis)", () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    originalRedisUrl = process.env.REDIS_URL;
    try {
      if (!process.env.REDIS_URL) {
        container = await new GenericContainer("redis:7-alpine")
          .withExposedPorts(6379)
          .withStartupTimeout(60000)
          .start();
        process.env.REDIS_URL = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
      }
      // The service builds its client while the module is evaluated, so it is
      // required only once REDIS_URL is known.
      redisService = require(redisServicePath);

      await redisService.ping();
      rawClient = openRawClient();
      redisAvailable = true;
      console.log(`Cache namespace integration test using ${process.env.REDIS_URL}`);
    } catch (err) {
      console.warn("Redis unavailable — cache namespace integration tests skipped:", err.message);
      redisAvailable = false;
    }
  });

  afterAll(async () => {
    try {
      if (redisAvailable) {
        const ours = [...LIST_KEYS, LEGACY_KEY, ROUNDTRIP_KEY, PREFIXED_KEY, WILDCARD_KEY]
          .map((k) => `${CACHE_KEY_PREFIX}${k}`);
        await rawClient.del(
          ...ours,
          FOREIGN_LIST_KEY,
          LEGACY_KEY, // the unprefixed entry planted by the "legacy" test
          FOREIGN_WILDCARD_KEY,
        );
      }
    } catch { /* ignore */ }
    try {
      if (rawClient) await rawClient.quit();
    } catch { /* ignore */ }
    try {
      await redisService?.quit();
    } catch { /* ignore */ }
    try {
      if (container) await container.stop();
    } catch { /* ignore */ }
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  test("stores the value under the `greenpay:` prefixed key", async () => {
    if (!redisAvailable) return;

    const cacheKey = key("leaderboard:page:1");
    await redisService.set(cacheKey, { rank: 1 }, 60);

    const stored = await rawClient.get(`${CACHE_KEY_PREFIX}${cacheKey}`);
    expect(JSON.parse(stored)).toEqual({ rank: 1 });

    await rawClient.del(`${CACHE_KEY_PREFIX}${cacheKey}`);
  });

  test("never writes the raw, unprefixed key", async () => {
    if (!redisAvailable) return;

    const cacheKey = key("stats:global");
    await redisService.set(cacheKey, { totalProjects: 3 }, 60);

    expect(await rawClient.get(cacheKey)).toBeNull();
    expect(await rawClient.get(`${CACHE_KEY_PREFIX}${cacheKey}`)).not.toBeNull();

    await rawClient.del(`${CACHE_KEY_PREFIX}${cacheKey}`);
  });

  test("get() returns null for a value that only exists under the raw key", async () => {
    if (!redisAvailable) return;

    // A legacy, unprefixed entry (as written by a pre-namespace deploy) or
    // another service's key: the service must not read it.
    await rawClient.set(LEGACY_KEY, JSON.stringify({ stale: true }), "EX", 60);

    expect(await redisService.get(LEGACY_KEY)).toBeNull();
  });

  test("get() round-trips a value written by set()", async () => {
    if (!redisAvailable) return;

    await redisService.set(ROUNDTRIP_KEY, { rank: 3 }, 60);

    expect(await redisService.get(ROUNDTRIP_KEY)).toEqual({ rank: 3 });
  });

  test("deletePattern() only invalidates keys inside the `greenpay:` namespace", async () => {
    if (!redisAvailable) return;

    for (const listKey of LIST_KEYS) await redisService.set(listKey, { cached: true }, 60);
    await rawClient.set(FOREIGN_LIST_KEY, JSON.stringify({ otherService: true }), "EX", 60);

    await redisService.deletePattern(`${key("projects:list")}:*`);

    for (const listKey of LIST_KEYS) {
      expect(await rawClient.get(`${CACHE_KEY_PREFIX}${listKey}`)).toBeNull();
    }
    expect(await rawClient.get(FOREIGN_LIST_KEY)).toEqual(JSON.stringify({ otherService: true }));
  });

  test("deletePattern() accepts an already namespaced pattern unchanged", async () => {
    if (!redisAvailable) return;

    await redisService.set(PREFIXED_KEY, { cached: true }, 60);

    await redisService.deletePattern(`${CACHE_KEY_PREFIX}${PREFIXED_KEY}`);

    expect(await rawClient.get(`${CACHE_KEY_PREFIX}${PREFIXED_KEY}`)).toBeNull();
  });

  test("a wildcard pattern never reaches a bare key owned by another service", async () => {
    if (!redisAvailable) return;

    // Without the namespace, `KEYS leaderboard*` would match — and delete —
    // another service's key.
    await redisService.set(WILDCARD_KEY, { ours: true }, 60);
    await rawClient.set(FOREIGN_WILDCARD_KEY, JSON.stringify({ theirs: true }), "EX", 60);

    await redisService.deletePattern("leaderboard*");

    expect(await rawClient.get(`${CACHE_KEY_PREFIX}${WILDCARD_KEY}`)).toBeNull();
    expect(await rawClient.get(FOREIGN_WILDCARD_KEY)).toEqual(JSON.stringify({ theirs: true }));
  });
});
