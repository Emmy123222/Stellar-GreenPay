/**
 * src/middleware/ssrf.js
 * SSRF and Webhook URL validation helpers.
 */
"use strict";

const net = require("net");

/**
 * Check if a 32-bit unsigned integer IPv4 address belongs to a private/internal range.
 *
 * @param {number} ipInt - Unsigned 32-bit integer IPv4.
 * @returns {boolean} True if private/reserved/loopback.
 */
function isPrivateIPv4Int(ipInt) {
  // 127.0.0.0/8 (Loopback)
  if (ipInt >>> 24 === 127) return true;
  // 10.0.0.0/8 (Private)
  if (ipInt >>> 24 === 10) return true;
  // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
  if (ipInt >>> 20 === 2753) return true; // (0xAC100000 >>> 20) = 2753
  // 192.168.0.0/16 (Private)
  if (ipInt >>> 16 === 49320) return true; // (0xC0A80000 >>> 16) = 49320
  // 169.254.0.0/16 (Link-Local & Cloud Metadata)
  if (ipInt >>> 16 === 43518) return true; // (0xA9FE0000 >>> 16) = 43518
  // 0.0.0.0/8 (Current network)
  if (ipInt >>> 24 === 0) return true;
  // 100.64.0.0/10 (Shared address space)
  if (ipInt >>> 22 === 401) return true; // (0x64400000 >>> 22) = 401
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (ipInt >>> 8 === 12582912) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (ipInt >>> 8 === 12582914) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (ipInt >>> 8 === 13000548) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (ipInt >>> 8 === 13303921) return true;
  // 224.0.0.0/4 (Multicast / Reserved)
  if (ipInt >>> 28 >= 14) return true;

  return false;
}

/**
 * Parse an IPv4 string (dotted quad, decimal, octal, hex) into a 32-bit unsigned int.
 *
 * @param {string} hostname - Hostname string.
 * @returns {number|null} 32-bit unsigned int or null if not valid IPv4.
 */
function parseIPv4ToUint32(hostname) {
  if (!hostname || typeof hostname !== "string") return null;

  const parts = hostname.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const octets = [];
  for (const part of parts) {
    let num;
    if (/^0x[0-9a-f]+$/i.test(part)) {
      num = Number.parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      num = Number.parseInt(part, 8);
    } else if (/^\d+$/.test(part)) {
      num = Number.parseInt(part, 10);
    } else {
      return null;
    }
    if (Number.isNaN(num) || num < 0) return null;
    octets.push(num);
  }

  if (octets.length === 1) {
    if (octets[0] > 0xffffffff) return null;
    return octets[0] >>> 0;
  }
  if (octets.length === 2) {
    if (octets[0] > 255 || octets[1] > 0xffffff) return null;
    return ((octets[0] << 24) | octets[1]) >>> 0;
  }
  if (octets.length === 3) {
    if (octets[0] > 255 || octets[1] > 255 || octets[2] > 0xffff) return null;
    return ((octets[0] << 24) | (octets[1] << 16) | octets[2]) >>> 0;
  }
  if (octets.length === 4) {
    if (
      octets[0] > 255 ||
      octets[1] > 255 ||
      octets[2] > 255 ||
      octets[3] > 255
    )
      return null;
    return (
      ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>>
      0
    );
  }

  return null;
}

/**
 * Check whether a hostname or IP address represents an internal/private target.
 *
 * @param {string} hostname - Domain or IP string to evaluate.
 * @returns {boolean} True if target is internal/private.
 */
function isPrivateTarget(hostname) {
  if (!hostname || typeof hostname !== "string") return true;

  const host = hostname
    .toLowerCase()
    .trim()
    .replace(/^\[|\]$/g, "");

  // Standard local hostnames & forbidden TLDs
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".invalid") ||
    host.endsWith(".localhost") ||
    host.endsWith(".test")
  ) {
    return true;
  }

  // IPv6 check
  const isIPv6 = net.isIPv6(host);
  if (isIPv6) {
    if (
      host === "::1" ||
      host === "0:0:0:0:0:0:0:1" ||
      host === "::" ||
      host === "0:0:0:0:0:0:0:0"
    ) {
      return true;
    }
    // IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1)
    if (host.startsWith("::ffff:")) {
      const ipv4Part = host.substring(7);
      const ipInt = parseIPv4ToUint32(ipv4Part);
      if (ipInt !== null && isPrivateIPv4Int(ipInt)) return true;
    }
    // fc00::/7 (Unique local)
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    // fe80::/10 (Link local)
    if (/^fe[89ab]/i.test(host)) return true;
    return false;
  }

  // IPv4 check
  const ipInt = parseIPv4ToUint32(host);
  if (ipInt !== null) {
    return isPrivateIPv4Int(ipInt);
  }

  return false;
}

/**
 * Validate a webhook URL for HTTPS-only protocol, private-IP SSRF safety, and length.
 *
 * @param {string} webhookUrl - The webhook URL to validate.
 * @returns {{ valid: boolean, error?: string }} Result object with validation state and error message.
 */
function validateWebhookUrl(webhookUrl) {
  if (!webhookUrl || typeof webhookUrl !== "string") {
    return { valid: false, error: "webhook_url must be a non-empty string" };
  }

  if (webhookUrl.length > 2000) {
    return {
      valid: false,
      error: "webhook_url must not exceed 2000 characters",
    };
  }

  if (!webhookUrl.toLowerCase().startsWith("https://")) {
    return { valid: false, error: "webhook_url must use HTTPS protocol" };
  }

  let urlObj;
  try {
    urlObj = new URL(webhookUrl);
  } catch {
    return { valid: false, error: "Invalid webhook_url format" };
  }

  if (urlObj.protocol !== "https:") {
    return { valid: false, error: "webhook_url must use HTTPS protocol" };
  }

  const hostname = urlObj.hostname;
  if (!hostname || isPrivateTarget(hostname)) {
    return {
      valid: false,
      error: "webhook_url cannot target internal or private IP addresses",
    };
  }

  return { valid: true };
}

module.exports = {
  isPrivateTarget,
  validateWebhookUrl,
};
