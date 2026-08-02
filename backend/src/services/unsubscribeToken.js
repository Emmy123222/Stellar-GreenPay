/**
 * HMAC-signed tokens for one-click email unsubscribe links.
 */
"use strict";

const crypto = require("crypto");

function getSecret() {
  return process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || "";
}

function normalizeEmail(email) {
  return String(email).toLowerCase().trim();
}

/**
 * Create a signed unsubscribe token for an email + project pair.
 *
 * @param {string} email
 * @param {string} projectId
 * @returns {string} base64url-encoded token
 */
function signUnsubscribeToken(email, projectId) {
  const secret = getSecret();
  if (!secret) {
    throw new Error("UNSUBSCRIBE_SECRET or JWT_SECRET must be set to sign unsubscribe tokens");
  }

  const payload = `${normalizeEmail(email)}:${projectId}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${signature}`, "utf8").toString("base64url");
}

/**
 * Verify a signed unsubscribe token.
 *
 * @param {string} token
 * @returns {{ email: string, projectId: string } | null}
 */
function verifyUnsubscribeToken(token) {
  const secret = getSecret();
  if (!secret || !token || typeof token !== "string") return null;

  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const sigSep = decoded.lastIndexOf(":");
    if (sigSep <= 0) return null;

    const payload = decoded.slice(0, sigSep);
    const signature = decoded.slice(sigSep + 1);
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    const sigBuf = Buffer.from(signature, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const emailSep = payload.indexOf(":");
    if (emailSep <= 0) return null;

    return {
      email: payload.slice(0, emailSep),
      projectId: payload.slice(emailSep + 1),
    };
  } catch {
    return null;
  }
}

module.exports = { signUnsubscribeToken, verifyUnsubscribeToken };
