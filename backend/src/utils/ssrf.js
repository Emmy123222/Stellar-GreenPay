/**
 * backend/src/utils/ssrf.js
 * Canonical SSRF guard for outbound webhook URLs: blocks localhost, private/
 * reserved IP ranges, obfuscated IPv4 forms, and cloud metadata addresses
 * (e.g. 169.254.169.254). This is the single implementation; do not duplicate it.
 */
"use strict";

const net = require("net");

class SsrfValidationError extends Error {}

/** Hostnames and pseudo-TLDs that are never public destinations. */
const FORBIDDEN_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".invalid",
  ".localhost",
  ".test",
];

/**
 * Blocked IPv4 ranges as [base, prefixLength].
 * Loopback, RFC1918, link-local (incl. the 169.254.169.254 metadata IP),
 * CGNAT, "this" network, IETF protocol assignments, documentation TEST-NETs,
 * and multicast/reserved space (224.0.0.0 and above).
 */
const IPV4_BLOCKED_RANGES = [
  ["127.0.0.0", 8],
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function dottedToLong(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
}

const IPV4_BLOCKED_INT_RANGES = IPV4_BLOCKED_RANGES.map(([base, prefix]) => ({
  base: dottedToLong(base),
  mask: prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0,
}));

function isBlockedIpv4Int(ipInt) {
  return IPV4_BLOCKED_INT_RANGES.some(({ base, mask }) => ((ipInt & mask) >>> 0) === base);
}

/**
 * Parse an IPv4 host in any form inet_aton accepts (dotted quad, 1-3 part
 * short forms like "127.1", decimal, octal, hex) into an unsigned 32-bit int.
 * Returns null when the string is not an IPv4 address.
 */
function parseIPv4ToUint32(hostname) {
  if (!hostname || typeof hostname !== "string") return null;
  const parts = hostname.split(".");
  if (parts.length > 4) return null;

  const nums = [];
  for (const part of parts) {
    let num;
    if (/^0x[0-9a-f]+$/i.test(part)) num = Number.parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) num = Number.parseInt(part, 8);
    else if (/^\d+$/.test(part)) num = Number.parseInt(part, 10);
    else return null;
    if (Number.isNaN(num) || num < 0) return null;
    nums.push(num);
  }

  // The last part fills all remaining bytes; every earlier part is one byte.
  const last = nums.pop();
  if (nums.some((n) => n > 255) || last >= 2 ** (8 * (4 - nums.length))) return null;
  return nums.reduce((acc, n, i) => acc + n * 2 ** (8 * (3 - i)), last) >>> 0;
}

/** Expand a valid IPv6 address (no zone id, no brackets) into its 8 hex groups. */
function expandIpv6Groups(ip) {
  const [headStr, tailStr] = ip.includes("::") ? ip.split("::") : [ip, undefined];
  const headParts = headStr ? headStr.split(":") : [];
  const tailParts = tailStr ? tailStr.split(":") : [];
  const missing = 8 - (headParts.length + tailParts.length);
  const zeros = new Array(Math.max(missing, 0)).fill("0");
  return [...headParts, ...zeros, ...tailParts];
}

function isBlockedIpv6(ip) {
  const lower = ip.toLowerCase();

  // "::ffff:a.b.c.d" mixes a dotted IPv4 into the hex groups, so detect it
  // before generic group expansion. The whole ::ffff:0:0/96 block is refused:
  // an IPv4-mapped address is never a legitimate public webhook target.
  if (lower.startsWith("::ffff:") && lower.includes(".")) return true;

  const groups = expandIpv6Groups(lower);
  const nums = groups.map((g) => Number.parseInt(g || "0", 16));
  if (nums.slice(0, 5).every((n) => n === 0) && nums[5] === 0xffff) return true; // ::ffff:0:0/96
  if (nums.slice(0, 7).every((n) => n === 0) && (nums[7] === 0 || nums[7] === 1)) return true; // :: and ::1
  if ((nums[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((nums[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

/** True when `ip` is a private, loopback, link-local, metadata or reserved address. */
function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) return isBlockedIpv4Int(dottedToLong(ip));
  if (type === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP at all — treat as unsafe
}

/**
 * Synchronous hostname/IP check (no DNS). True when the host is localhost, a
 * forbidden pseudo-TLD, a blocked IP literal, or an obfuscated IPv4 form
 * (decimal, octal, hex, short dotted) that points at a blocked address.
 */
function isPrivateTarget(hostname) {
  if (!hostname || typeof hostname !== "string") return true;
  const host = hostname.toLowerCase().trim().replace(/^\[|\]$/g, "");
  if (!host) return true;

  if (host === "localhost" || FORBIDDEN_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (net.isIPv6(host)) return isBlockedIpv6(host);

  const ipInt = parseIPv4ToUint32(host);
  return ipInt !== null && isBlockedIpv4Int(ipInt);
}

async function resolveAllIps(hostname, dnsResolver) {
  const [v4, v6] = await Promise.all([
    dnsResolver.resolve4(hostname).catch(() => []),
    dnsResolver.resolve6(hostname).catch(() => []),
  ]);
  const addresses = [...v4, ...v6];
  if (addresses.length === 0) {
    throw new SsrfValidationError(`Could not resolve hostname: ${hostname}`);
  }
  return addresses;
}

/**
 * Throws SsrfValidationError if the URL is not a safe, publicly-routable
 * http/https destination. Resolves with no value on success.
 */
async function assertPublicHttpUrl(rawUrl, dnsResolver = require("dns").promises) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfValidationError("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfValidationError("URL must use http or https");
  }

  if (url.hostname.includes("%")) {
    throw new SsrfValidationError("IPv6 zone identifiers are not allowed");
  }

  // WHATWG URL keeps brackets around IPv6 literals in `.hostname` (e.g. "[::1]").
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;

  const ipType = net.isIP(hostname);
  if (ipType) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsrfValidationError(`Blocked private/reserved IP: ${hostname}`);
    }
    return;
  }

  if (isPrivateTarget(hostname)) {
    throw new SsrfValidationError(`Blocked internal hostname: ${hostname}`);
  }

  if (parseIPv4ToUint32(hostname) !== null) {
    throw new SsrfValidationError("Numeric IP obfuscation is not allowed");
  }

  const addresses = await resolveAllIps(hostname, dnsResolver);
  for (const ip of addresses) {
    if (isPrivateOrReservedIp(ip)) {
      throw new SsrfValidationError(`Hostname resolves to blocked address: ${ip}`);
    }
  }
}

/**
 * Boolean wrapper around assertPublicHttpUrl: true only when the URL is a
 * safe, publicly-routable http/https destination.
 */
async function isUrlSafeFromSsrf(rawUrl, dnsResolver) {
  try {
    await assertPublicHttpUrl(rawUrl, dnsResolver);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous webhook_url validation for request handlers: HTTPS only, at most
 * 2000 characters, and no internal/private target. Does not resolve DNS; use
 * assertPublicHttpUrl for that.
 *
 * @returns {{ valid: boolean, error?: string }}
 */
function validateWebhookUrl(webhookUrl) {
  if (!webhookUrl || typeof webhookUrl !== "string") {
    return { valid: false, error: "webhook_url must be a non-empty string" };
  }
  if (webhookUrl.length > 2000) {
    return { valid: false, error: "webhook_url must not exceed 2000 characters" };
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
  if (!urlObj.hostname || isPrivateTarget(urlObj.hostname)) {
    return {
      valid: false,
      error: "webhook_url cannot target internal or private IP addresses",
    };
  }
  return { valid: true };
}

module.exports = {
  assertPublicHttpUrl,
  isUrlSafeFromSsrf,
  validateWebhookUrl,
  isPrivateTarget,
  isPrivateOrReservedIp,
  isPrivateIp: isPrivateOrReservedIp,
  SsrfValidationError,
};
