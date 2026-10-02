/**
 * backend/src/utils/ssrf.js
 * SSRF guard for outbound webhook URLs: blocks localhost, private/reserved
 * IP ranges, and cloud metadata addresses (e.g. 169.254.169.254).
 */
"use strict";

const net = require("net");

class SsrfValidationError extends Error {}

const BARE_NUMERIC_HOST_RE = /^(0x[0-9a-f]+|[0-9]+)$/i;

function ipv4ToLong(ip) {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
}

function ipv4InRange(ip, base, prefixLength) {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(base) & mask);
}

const IPV4_BLOCKED_RANGES = [
  ["127.0.0.0", 8], // loopback
  ["0.0.0.0", 8], // "this" network / unspecified
  ["10.0.0.0", 8], // RFC1918
  ["172.16.0.0", 12], // RFC1918
  ["192.168.0.0", 16], // RFC1918
  ["169.254.0.0", 16], // link-local (covers 169.254.169.254 metadata IP)
  ["100.64.0.0", 10], // CGNAT
];

function isBlockedIpv4(ip) {
  return IPV4_BLOCKED_RANGES.some(([base, prefix]) => ipv4InRange(ip, base, prefix));
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

/** Extract the embedded IPv4 address from an IPv4-mapped IPv6 address, or null. */
function extractMappedIpv4(groups) {
  const isMapped = groups.slice(0, 5).every((g) => Number.parseInt(g || "0", 16) === 0) &&
    Number.parseInt(groups[5] || "0", 16) === 0xffff;
  if (!isMapped) return null;
  const high = Number.parseInt(groups[6] || "0", 16);
  const low = Number.parseInt(groups[7] || "0", 16);
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(".");
}

function isBlockedIpv6(ip) {
  const lower = ip.toLowerCase();

  // The "::ffff:a.b.c.d" dotted-quad shorthand mixes a literal IPv4 address
  // into what is otherwise a colon-separated hex-group address, so it must
  // be detected before generic group expansion (which assumes every segment
  // is a hex group).
  const dottedMapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMapped) return isBlockedIpv4(dottedMapped[1]);

  const groups = expandIpv6Groups(lower);
  const mappedV4 = extractMappedIpv4(groups);
  if (mappedV4) return isBlockedIpv4(mappedV4);
  if (groups.every((g) => Number.parseInt(g || "0", 16) === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => Number.parseInt(g || "0", 16) === 0) && groups[7] === "1") return true; // ::1
  const first = Number.parseInt(groups[0] || "0", 16);
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) return isBlockedIpv4(ip);
  if (type === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP at all — treat as unsafe
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

  if (hostname.toLowerCase() === "localhost") {
    throw new SsrfValidationError("localhost is not allowed");
  }

  if (BARE_NUMERIC_HOST_RE.test(hostname)) {
    throw new SsrfValidationError("Numeric IP obfuscation is not allowed");
  }

  const addresses = await resolveAllIps(hostname, dnsResolver);
  for (const ip of addresses) {
    if (isPrivateOrReservedIp(ip)) {
      throw new SsrfValidationError(`Hostname resolves to blocked address: ${ip}`);
    }
  }
}

module.exports = { assertPublicHttpUrl, isPrivateOrReservedIp, SsrfValidationError };
