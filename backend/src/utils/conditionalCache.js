/**
 * src/utils/conditionalCache.js
 * Helpers for HTTP conditional caching (ETag & Last-Modified).
 */
"use strict";

const crypto = require("crypto");

/**
 * Normalizes an ETag string by stripping weak indicators (W/) and surrounding quotes.
 * @param {string} etag
 * @returns {string}
 */
function normalizeETag(etag) {
  if (!etag) return "";
  return etag.replace(/^W\//, "").replace(/^"|"$/g, "").trim();
}

/**
 * Deterministically generates an ETag hash from the serialized response body.
 * @param {object|string} body
 * @returns {string} ETag header value formatted as "<hash>"
 */
function generateETag(body) {
  const content = typeof body === "string" ? body : JSON.stringify(body);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `"${hash}"`;
}

/**
 * Formats a Date object or timestamp as an HTTP-date string (RFC 7231 / GMT).
 * @param {Date|number|string} date
 * @returns {string}
 */
function formatLastModified(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toUTCString();
}

/**
 * Handles conditional caching logic for GET requests.
 * Sets ETag, Last-Modified, and Cache-Control headers.
 * Evaluates If-None-Match and If-Modified-Since headers to send HTTP 304 if unchanged.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {object} payload - The response data body.
 * @param {Date|number|string} lastModifiedInput - The latest update timestamp.
 * @param {string} [existingEtag] - Precalculated ETag (optional).
 * @returns {import("express").Response}
 */
function sendConditionalResponse(req, res, payload, lastModifiedInput, existingEtag = null) {
  const lastModifiedDate = lastModifiedInput instanceof Date ? lastModifiedInput : new Date(lastModifiedInput);
  const lastModifiedHeader = formatLastModified(lastModifiedDate);
  const etag = existingEtag || generateETag(payload);

  res.set("Cache-Control", "public, max-age=300");
  res.set("ETag", etag);
  res.set("Last-Modified", lastModifiedHeader);

  // 1. Evaluate If-None-Match header
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch) {
    const clientETag = normalizeETag(ifNoneMatch);
    const serverETag = normalizeETag(etag);

    if (ifNoneMatch === "*" || clientETag === serverETag) {
      return res.status(304).end();
    }
  }

  // 2. Evaluate If-Modified-Since header
  const ifModifiedSince = req.headers["if-modified-since"];
  if (ifModifiedSince) {
    const ifModifiedSinceTime = Date.parse(ifModifiedSince);
    if (!isNaN(ifModifiedSinceTime)) {
      // Compare with 1-second precision
      const lastModifiedSec = Math.floor(lastModifiedDate.getTime() / 1000);
      const ifModifiedSinceSec = Math.floor(ifModifiedSinceTime / 1000);

      if (lastModifiedSec <= ifModifiedSinceSec) {
        return res.status(304).end();
      }
    }
  }

  return res.json(payload);
}

module.exports = {
  generateETag,
  formatLastModified,
  normalizeETag,
  sendConditionalResponse,
};
