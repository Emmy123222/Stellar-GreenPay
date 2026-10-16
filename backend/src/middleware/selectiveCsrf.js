"use strict";

const crypto = require("crypto");

/**
 * Paths (or prefixes) that are exempt from CSRF validation.
 * Order matters for startsWith checks: more-specific prefixes first.
 */
const EXEMPT_PREFIXES = [
  "/api/mobile/",
  "/api/v1/mobile/",
  "/api/extension/",
  "/api/v1/extension/",
  "/api/notifications",
  "/api/v1/notifications",
];

const EXEMPT_EXACT = new Set([
  "/health",
  "/api/health",
  "/api/v1/health",
  "/api/readiness",
  // Prometheus scrape endpoints are machine-to-machine, not browser forms.
  "/metrics",
  "/api/metrics",
]);
const DEFAULT_IGNORE_METHODS = ["GET", "HEAD", "OPTIONS"];
const RANDOM_VALUE_BYTES = 32;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

// Derive a CSRF-only signing key from a shared deployment secret when present.
// The random fallback keeps development and tests self-contained; deployments
// with multiple workers should provide CSRF_SECRET (or the shared JWT_SECRET).
const configuredSecret = process.env.CSRF_SECRET || process.env.JWT_SECRET;
const SIGNING_KEY = configuredSecret
  ? crypto.createHmac("sha256", configuredSecret).update("stellar-greenpay:csrf:v1").digest()
  : crypto.randomBytes(RANDOM_VALUE_BYTES);

function isCsrfExempt(path) {
  if (EXEMPT_EXACT.has(path)) return true;
  for (const prefix of EXEMPT_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function decodeRandomValue(value) {
  if (typeof value !== "string" || !BASE64URL_32_BYTES.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === RANDOM_VALUE_BYTES && decoded.toString("base64url") === value
    ? decoded
    : null;
}

function createToken(cookieSecret) {
  const nonce = crypto.randomBytes(RANDOM_VALUE_BYTES).toString("base64url");
  return `${nonce}.${createSignature(cookieSecret, nonce)}`;
}

function isValidToken(token, cookieSecret) {
  if (typeof token !== "string" || token.length > 100) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !decodeRandomValue(parts[0]) || !decodeRandomValue(parts[1])) {
    return false;
  }

  const expected = Buffer.from(createSignature(cookieSecret, parts[0]), "base64url");
  const actual = Buffer.from(parts[1], "base64url");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSignature(cookieSecret, nonce) {
  return crypto
    .createHmac("sha256", SIGNING_KEY)
    .update(`${cookieSecret}.${nonce}`)
    .digest("base64url");
}

function getRequestToken(req) {
  const headerToken = typeof req.get === "function"
    ? req.get("csrf-token") ||
      req.get("xsrf-token") ||
      req.get("x-csrf-token") ||
      req.get("x-xsrf-token")
    : undefined;

  return (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    headerToken;
}

function csrfError() {
  const error = new Error("invalid csrf token");
  error.code = "EBADCSRFTOKEN";
  error.status = 403;
  return error;
}

/**
 * Returns an Express middleware that checks signed double-submit CSRF tokens
 * on non-exempt paths. It preserves the csurf-facing req.csrfToken() method
 * and the cookie / ignoreMethods options used by server.js.
 *
 * @param {object} csrfOptions
 * @returns {import("express").RequestHandler}
 */
function createSelectiveCsrf(csrfOptions = {}) {
  const cookieOptions = { ...(csrfOptions.cookie || {}) };
  const cookieName = cookieOptions.key || "_csrf";
  delete cookieOptions.key;
  delete cookieOptions.signed;
  const ignoreMethods = csrfOptions.ignoreMethods || DEFAULT_IGNORE_METHODS;

  return function selectiveCsrfMiddleware(req, res, next) {
    if (isCsrfExempt(req.path)) return next();

    const cookieSecret = req.cookies && Object.entries(req.cookies)
      .find(([name]) => name === cookieName)?.[1];
    const validCookieSecret = decodeRandomValue(cookieSecret) ? cookieSecret : null;
    let generatedCookieSecret = null;
    let cookieWasSet = false;

    req.csrfToken = function csrfToken() {
      const secret = validCookieSecret || (generatedCookieSecret ||= crypto
        .randomBytes(RANDOM_VALUE_BYTES)
        .toString("base64url"));

      if (!validCookieSecret && !cookieWasSet) {
        res.cookie(cookieName, secret, cookieOptions);
        cookieWasSet = true;
      }

      return createToken(secret);
    };

    if (ignoreMethods.includes(req.method)) return next();

    const token = getRequestToken(req);
    if (!validCookieSecret || !isValidToken(token, validCookieSecret)) {
      return next(csrfError());
    }

    return next();
  };
}

module.exports = { createSelectiveCsrf, isCsrfExempt };
