"use strict";
const Redis = require("ioredis");

const url = process.env.REDIS_URL || "redis://localhost:6379";

const client = new Redis(url, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
});

client.on("error", () => {
  // Redis connection errors are non-fatal; cache is bypassed on failure
});

const connectionPromise = client.connect().catch(() => {
  // Non-fatal: server runs without cache if Redis is unavailable
});

async function getConnectedClient() {
  if (client.status !== "ready" && connectionPromise) {
    await connectionPromise;
  }
  if (client.status !== "ready") {
    throw new Error("Redis unavailable");
  }
  return client;
}

const memStore = new Map();
const memTtl = new Map();

function handleMemCommand(command, ...args) {
  const cmd = String(command).toLowerCase();
  const now = Date.now();

  for (const [k, exp] of memTtl.entries()) {
    if (exp <= now) {
      memStore.delete(k);
      memTtl.delete(k);
    }
  }

  if (cmd === "script") {
    return "mocksha1234567890123456789012345678901234567890";
  }

  if (cmd === "eval" || cmd === "evalsha") {
    const keyStr = args.find((a) => typeof a === "string" && (a.includes("rate-limit") || a.includes("greenpay:")));
    const k = keyStr || String(args[2] || args[1] || "default");
    const count = (memStore.get(k) || 0) + 1;
    memStore.set(k, count);
    if (!memTtl.has(k)) {
      memTtl.set(k, now + 60000);
    }
    const resetTime = memTtl.get(k);
    return [count, resetTime];
  }

  if (cmd === "keys") {
    const patternStr = args[0] ? new RegExp("^" + String(args[0]).replace(/\*/g, ".*") + "$") : /.*/;
    return Array.from(memStore.keys()).filter((k) => patternStr.test(k));
  }

  if (cmd === "del" || cmd === "unlink") {
    let deleted = 0;
    for (const k of args) {
      if (typeof k === "string" && k.includes("*")) {
        const regex = new RegExp("^" + k.replace(/\*/g, ".*") + "$");
        for (const existingKey of Array.from(memStore.keys())) {
          if (regex.test(existingKey)) {
            memStore.delete(existingKey);
            memTtl.delete(existingKey);
            deleted++;
          }
        }
      } else if (memStore.delete(k)) {
        memTtl.delete(k);
        deleted++;
      }
    }
    return deleted;
  }

  if (cmd === "get") {
    return memStore.get(args[0]) ?? null;
  }

  if (cmd === "set") {
    memStore.set(args[0], args[1]);
    return "OK";
  }

  return 1;
}

async function sendCommand(command, ...args) {
  try {
    const c = await getConnectedClient();
    return await c.call(command, ...args);
  } catch (err) {
    return handleMemCommand(command, ...args);
  }
}

async function get(key) {
  try {
    const c = await getConnectedClient();
    const value = await c.get(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  try {
    const c = await getConnectedClient();
    await c.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache write failure is non-fatal
  }
}

async function deletePattern(pattern) {
  try {
    const c = await getConnectedClient();
    const keys = await c.keys(pattern);
    if (keys.length > 0) {
      await c.del(...keys);
    }
  } catch {
    handleMemCommand("del", pattern);
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
  if (client.status === "ready") {
    await client.quit();
  }
}

module.exports = { client, get, set, deletePattern, ping, sendCommand, quit };
