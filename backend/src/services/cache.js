/**
 * src/services/cache.js
 * Tiny in-memory TTL cache (process-local).
 *
 * Keys are namespaced with `greenpay:` (see utils/cacheKeys.js) so this
 * cache cannot collide with another service's keys if it is ever shared or
 * moved behind a networked store.
 */
"use strict";

const { namespacedKey } = require("../utils/cacheKeys");

const store = new Map();

function nowMs() {
  return Date.now();
}

function get(key) {
  const namespaced = namespacedKey(key);
  const entry = store.get(namespaced);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    store.delete(namespaced);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  store.set(namespacedKey(key), { value, expiresAt: nowMs() + ttlMs });
  return value;
}

/**
 * List the fully-qualified (namespaced) keys currently held by the cache.
 * Expired entries are pruned as a side effect, so the result only contains
 * live keys. Intended for diagnostics and tests.
 *
 * @returns {string[]} A snapshot of the namespaced keys in the cache.
 */
function keys() {
  const now = nowMs();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  return [...store.keys()];
}

/**
 * Remove a single key from the in-memory TTL cache. The key is namespaced
 * the same way as `get`/`set`.
 *
 * @param {string} key - Cache key.
 * @returns {boolean} True when an entry was present and removed.
 */
function del(key) {
  return store.delete(namespacedKey(key));
}

/**
 * Get a value from the in-memory TTL cache.
 *
 * @param {string} key - Cache key (namespaced automatically).
 * @returns {any|null} The cached value or null if missing/expired.
 */
// exported as `get`

/**
 * Set a value in the in-memory TTL cache.
 *
 * @param {string} key - Cache key (namespaced automatically).
 * @param {any} value - Value to cache.
 * @param {number} ttlMs - Time-to-live in milliseconds.
 * @returns {any} The value that was stored.
 */
// exported as `set`

module.exports = { get, set, del, keys };
