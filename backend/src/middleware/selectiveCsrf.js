"use strict";

/**
 * selectiveCsrf.js
 *
 * Wraps the `csurf` middleware so that it is applied selectively:
 *
 *  EXEMPT (no CSRF check):
 *    - /api/mobile/*       — React Native clients; no cookie jar
 *    - /api/extension/*    — browser-extension clients; no same-origin cookie
 *    - /api/notifications* — SSE push routes (pre-existing exemption)
 *    - /health, /api/health, /api/v1/health, /api/readiness — infra probes
 *
 *  PROTECTED (CSRF required):
 *    - All other routes, matching the original server-wide behaviour
 *
 * Mobile and extension clients are expected to authenticate via
 * Authorization: Bearer <jwt> or Stellar wallet-signature headers instead.
 */

const csurf = require("csurf");

/**
 * Paths (or prefixes) that are exempt from CSRF validation.
 * Order matters for startsWith checks — more-specific prefixes first.
 */
const EXEMPT_PREFIXES = [
  "/api/mobile/",
  "/api/extension/",
  "/api/notifications",
  "/api/v1/notifications",
];

const EXEMPT_EXACT = new Set(["/health", "/api/health", "/api/v1/health", "/api/readiness"]);

/**
 * Returns true when the given request path should skip CSRF enforcement.
 *
 * @param {string} path - req.path value from Express
 * @returns {boolean}
 */
function isCsrfExempt(path) {
  if (EXEMPT_EXACT.has(path)) return true;
  for (const prefix of EXEMPT_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Factory — returns an Express middleware that applies csurf only to
 * non-exempt paths.
 *
 * @param {object} csrfOptions - Options forwarded to `csurf({ cookie: ... })`
 * @returns {import("express").RequestHandler}
 */
function createSelectiveCsrf(csrfOptions) {
  const csrfProtection = csurf(csrfOptions);

  return function selectiveCsrfMiddleware(req, res, next) {
    if (isCsrfExempt(req.path)) {
      return next();
    }
    return csrfProtection(req, res, next);
  };
}

module.exports = { createSelectiveCsrf, isCsrfExempt };
