"use strict";
const Redis = require("ioredis");

let client = null;
let connectionPromise = null;

function getClient() {
  if (client) return client;

  const url = process.env.REDIS_URL || "redis://localhost:6379";
  client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
  });

  client.on("error", () => {
    // Redis connection errors are non-fatal; cache is bypassed on failure
  });

  connectionPromise = client.connect().catch(() => {
    // Non-fatal: server runs without cache if Redis is unavailable
  });

  return client;
}

async function getConnectedClient() {
  const c = getClient();
  if (c.status !== "ready" && connectionPromise) {
    await connectionPromise;
  }
  if (c.status !== "ready") {
    throw new Error("Redis unavailable");
  }
  return c;
}

async function sendCommand(command, ...args) {
  const c = await getConnectedClient();
  return c.call(command, ...args);
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
    // Cache invalidation failure is non-fatal
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

module.exports = { get, set, deletePattern, ping, sendCommand };
