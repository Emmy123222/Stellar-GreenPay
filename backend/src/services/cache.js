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

/**
 * Get a value from the in-memory TTL cache.
 *
 * @param {string} key - Cache key.
 * @returns {any|null} The cached value or null if missing/expired.
 */
// exported as `get`

/**
 * Set a value in the in-memory TTL cache.
 *
 * @param {string} key - Cache key.
 * @param {any} value - Value to cache.
 * @param {number} ttlMs - Time-to-live in milliseconds.
 * @returns {any} The value that was stored.
 */
// exported as `set`

module.exports = { get, set };

