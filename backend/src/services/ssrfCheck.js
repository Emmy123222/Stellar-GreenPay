/**
 * src/services/ssrfCheck.js
 * Minimal SSRF guard for user-supplied outbound webhook URLs.
 *
 * Resolves the hostname and rejects any URL whose IP falls in a
 * private/loopback/link-local/reserved range, so an attacker can't point
 * a webhook at internal infrastructure.
 */
"use strict";

const dns = require("dns").promises;
const net = require("net");
const { isInSubnet } = require("is-in-subnet");

const PRIVATE_IPV4_RANGES = [
  { base: "10.0.0.0", bits: 8 },
  { base: "172.16.0.0", bits: 12 },
  { base: "192.168.0.0", bits: 16 },
  { base: "127.0.0.0", bits: 8 },
  { base: "169.254.0.0", bits: 16 },
  { base: "0.0.0.0", bits: 8 },
];

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip) {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(({ base, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipInt & mask) === (ipv4ToInt(base) & mask);
  });
}

const IPV6_BLOCKED_SUBNETS = [
  "::1/128",
  "::/128",
  "fe80::/10",
  "fc00::/7",
  "::ffff:0:0/96",
];

function isPrivateIpv6(ip) {
  const normalized = String(ip).toLowerCase().split("%")[0];
  try {
    return IPV6_BLOCKED_SUBNETS.some((subnet) => isInSubnet(normalized, subnet));
  } catch {
    return true;
  }
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // unknown/unparseable -> treat as unsafe
}

/**
 * Verify that a URL's hostname does not resolve to a private, loopback,
 * link-local, or otherwise reserved IP address.
 *
 * @param {string} urlString - The URL to check.
 * @returns {Promise<boolean>} True if the URL is safe to use, false otherwise.
 */
async function isUrlSafeFromSsrf(urlString) {
  let hostname;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return false;
  }

  if (net.isIP(hostname)) {
    return !isPrivateIp(hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) return false;
    return records.every((record) => !isPrivateIp(record.address));
  } catch {
    return false;
  }
}

module.exports = { isUrlSafeFromSsrf, isPrivateIp };
