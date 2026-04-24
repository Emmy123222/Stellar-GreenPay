/**
 * src/services/cache.js
 * Tiny in-memory TTL cache (process-local).
 */
"use strict";

const store = new Map();

function nowMs() {
  return Date.now();
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expiresAt: nowMs() + ttlMs });
  return value;
}

module.exports = { get, set };

