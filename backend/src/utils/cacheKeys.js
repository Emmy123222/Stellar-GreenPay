/**
 * backend/src/utils/cacheKeys.js
 * Single source of truth for cache key namespacing.
 *
 * Redis instances are frequently shared between services (managed Redis,
 * a sidecar container, a cluster with several databases). Without a
 * namespace, a bare key such as `project:abc123` or a wildcard such as
 * `projects:list:*` can collide with — and silently corrupt — another
 * application's data. Every key this service writes is therefore
 * qualified with the `greenpay:` prefix:
 *
 *   greenpay:project:abc123
 *   greenpay:leaderboard:page:1
 *   greenpay:projects:list:*
 *
 * The prefix is applied centrally by the cache services
 * (`services/redis.js` and `services/cache.js`) rather than at each call
 * site, so a new call site cannot forget it.
 */
"use strict";

/** Logical namespace for every key owned by this service. */
const CACHE_NAMESPACE = "greenpay";

/** Separator between the namespace and the caller-supplied key. */
const CACHE_KEY_SEPARATOR = ":";

/** Prefix prepended to every cache key, e.g. `greenpay:`. */
const CACHE_KEY_PREFIX = `${CACHE_NAMESPACE}${CACHE_KEY_SEPARATOR}`;

/**
 * Return `key` qualified with the cache namespace.
 *
 * Idempotent: a key that is already namespaced is returned unchanged, so
 * passing an explicit `greenpay:...` key is never double-prefixed. Wildcard
 * patterns (`projects:list:*`) are namespaced at the front, which keeps the
 * pattern itself intact.
 *
 * @param {string} key - Caller-supplied cache key or key pattern.
 * @returns {string} The namespaced key/pattern.
 * @throws {TypeError} If `key` is not a non-empty string.
 */
function namespacedKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("Cache key must be a non-empty string");
  }
  return key.startsWith(CACHE_KEY_PREFIX) ? key : `${CACHE_KEY_PREFIX}${key}`;
}

/**
 * Whether a (possibly namespaced) key/pattern belongs to this service's
 * namespace. Used to assert that reads and invalidation stay inside the
 * namespace, and to detect accidental cross-namespace access.
 *
 * @param {string} key - Cache key or key pattern.
 * @returns {boolean} True when `key` is namespaced.
 */
function isNamespacedKey(key) {
  return typeof key === "string" && key.startsWith(CACHE_KEY_PREFIX);
}

module.exports = {
  CACHE_NAMESPACE,
  CACHE_KEY_SEPARATOR,
  CACHE_KEY_PREFIX,
  namespacedKey,
  isNamespacedKey,
};
