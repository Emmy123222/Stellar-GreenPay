"use strict";

const crypto = require("crypto");
const Redis = require("ioredis");
const { CACHE_KEY_PREFIX, namespacedKey } = require("../utils/cacheKeys");

const isTest = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
const isMockedByJest = typeof jest !== "undefined" && jest.isMockFunction(Redis);

const url = process.env.REDIS_URL || "redis://localhost:6379";

let client;

if (isTest && !isMockedByJest) {
  const RedisMock = require("ioredis-mock");
  client = new RedisMock();
} else {
  client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
  });
}

if (!isTest || isMockedByJest) {
  client.on("error", () => {
    // Redis connection errors are non-fatal; cache is bypassed on failure
  });
}

const connectionPromise = (isTest && !isMockedByJest)
  ? Promise.resolve()
  : client.connect().catch(() => {
      // Non-fatal: server runs without cache if Redis is unavailable
    });

const mockScripts = new Map();

async function getConnectedClient() {
  if (isTest && !isMockedByJest) {
    return client;
  }

  if (client.status !== "ready" && connectionPromise) {
    await connectionPromise;
  }
  if (client.status !== "ready") {
    throw new Error("Redis unavailable");
  }
  return client;
}

// NOTE: `sendCommand` is a raw escape hatch and is deliberately NOT
// namespaced — it forwards whatever the caller passes. Its only in-tree
// consumer is `middleware/rateLimiter.js`, where `rate-limit-redis` applies
// its own `greenpay:rate-limit:` prefix to the keys it builds. Namespacing
// here as well would produce `greenpay:greenpay:rate-limit:...` keys.
async function sendCommand(command, ...args) {
  const c = await getConnectedClient();
  const cmd = String(command).toLowerCase();

  if (isTest) {
    if (cmd === "script") {
      const subCmd = String(args[0]).toLowerCase();
      if (subCmd === "load") {
        const scriptText = args[1] || "";
        const sha = crypto.createHash("sha1").update(scriptText).digest("hex");
        mockScripts.set(sha, scriptText);
        return sha;
      }
      if (subCmd === "exists") {
        const shas = args.slice(1);
        return shas.map((sha) => (mockScripts.has(sha) ? 1 : 0));
      }
      return "OK";
    }

    if (cmd === "evalsha") {
      const sha = args[0];
      if (mockScripts.has(sha)) {
        const scriptText = mockScripts.get(sha);
        return sendCommand("eval", scriptText, ...args.slice(1));
      }
      if (typeof c.evalsha === "function") {
        return c.evalsha(...args);
      }
      throw new Error("NOSCRIPT No matching script. use EVAL.");
    }
  }

  if (typeof c.call === "function") {
    return c.call(command, ...args);
  }
  if (typeof c[cmd] === "function") {
    return c[cmd](...args);
  }
  throw new Error(`Unsupported Redis command: ${command}`);
}

async function get(key) {
  try {
    const c = await getConnectedClient();
    const value = await c.get(namespacedKey(key));
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  try {
    const c = await getConnectedClient();
    await c.set(namespacedKey(key), JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache write failure is non-fatal
  }
}

async function deletePattern(pattern) {
  try {
    const c = await getConnectedClient();
    // Scoped to the `greenpay:` namespace so invalidation can never delete
    // keys owned by another service sharing the same Redis instance.
    const keys = await c.keys(namespacedKey(pattern));
    if (keys.length > 0) {
      await c.del(...keys);
    }
  } catch {
    // Cache invalidation failure is non-fatal
  }
  try {
    const { clearMemoryStore } = require("../middleware/rateLimiter");
    clearMemoryStore(pattern);
  } catch {
    // Non-fatal
  }
}

async function ping() {
  const c = await getConnectedClient();
  const result = await c.ping();
  if (result !== "PONG") {
    throw new Error("Redis ping failed");
  }
  return result;
}

async function quit() {
  if (isTest && !isMockedByJest) return;
  if (client.status === "ready") {
    await client.quit();
  }
}

module.exports = { client, get, set, deletePattern, ping, sendCommand, quit, CACHE_KEY_PREFIX };
