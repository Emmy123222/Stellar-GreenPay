/**
 * backend/src/services/webhook.js
 * Webhook delivery service for project milestone notifications.
 *
 * Deliveries are persisted in `webhook_deliveries` and processed via pg-boss
 * with exponential backoff: retry at 1m, 5m, 30m, 2h. Marked failed after 5 attempts.
 */
"use strict";

const crypto = require("crypto");
const dns = require("dns");
const https = require("https");
const http = require("http");
const net = require("net");
const pool = require("../db/pool");
const logger = require("../logger");
const { assertPublicHttpUrl } = require("../utils/ssrf");

const QUEUE = "webhook-delivery";
const MAX_ATTEMPTS = 5;
/** Delay (seconds) before the next attempt after failures 1–4. */
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200]; // 1m, 5m, 30m, 2h

let boss = null;

// ---------------------------------------------------------------------------
// Private & reserved IPv4 CIDR ranges (SSRF blacklist)
// ---------------------------------------------------------------------------
const PRIVATE_IPV4_RANGES = Object.freeze([
  Object.freeze({ start: ip4ToInt("0.0.0.0"),       end: ip4ToInt("0.255.255.255"),     label: "0.0.0.0/8" }),
  Object.freeze({ start: ip4ToInt("10.0.0.0"),      end: ip4ToInt("10.255.255.255"),    label: "10.0.0.0/8" }),
  Object.freeze({ start: ip4ToInt("100.64.0.0"),    end: ip4ToInt("100.127.255.255"),   label: "100.64.0.0/10" }),
  Object.freeze({ start: ip4ToInt("127.0.0.0"),     end: ip4ToInt("127.255.255.255"),   label: "127.0.0.0/8" }),
  Object.freeze({ start: ip4ToInt("169.254.0.0"),   end: ip4ToInt("169.254.255.255"),   label: "169.254.0.0/16" }),
  Object.freeze({ start: ip4ToInt("172.16.0.0"),    end: ip4ToInt("172.31.255.255"),    label: "172.16.0.0/12" }),
  Object.freeze({ start: ip4ToInt("192.0.2.0"),     end: ip4ToInt("192.0.2.255"),       label: "192.0.2.0/24" }),
  Object.freeze({ start: ip4ToInt("192.168.0.0"),   end: ip4ToInt("192.168.255.255"),   label: "192.168.0.0/16" }),
  Object.freeze({ start: ip4ToInt("198.18.0.0"),    end: ip4ToInt("198.19.255.255"),    label: "198.18.0.0/15" }),
  Object.freeze({ start: ip4ToInt("198.51.100.0"),  end: ip4ToInt("198.51.100.255"),    label: "198.51.100.0/24" }),
  Object.freeze({ start: ip4ToInt("203.0.113.0"),   end: ip4ToInt("203.0.113.255"),     label: "203.0.113.0/24" }),
]);

/** Convert a dotted-quad IPv4 string to a 32-bit integer. */
function ip4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Default timeout (ms) for DNS lookups in webhook validation. */
const DNS_TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// IPv4 helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `address` (IPv4 string) falls inside any of the private or
 * reserved ranges defined in PRIVATE_IPV4_RANGES.
 *
 * @param {string} address - IPv4 dotted-quad string.
 * @returns {{ blocked: boolean, range?: string }}
 */
function checkPrivateIPv4(address) {
  if (!net.isIPv4(address)) return { blocked: false };
  const num = ip4ToInt(address);
  for (const range of PRIVATE_IPV4_RANGES) {
    if (num >= range.start && num <= range.end) {
      return { blocked: true, range: range.label };
    }
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// IPv6 helpers
// ---------------------------------------------------------------------------

/** Regex to detect IPv4-mapped/compat IPv6 addresses in dotted-quad form (e.g. ::ffff:192.168.1.1). */
const IPV4_MAPPED_DOT_RE = /^::(?:ffff|0)(?::0)?:(\d+\.\d+\.\d+\.\d+)$/i;

/** Strip surrounding square brackets from a hostname if present. */
function stripBrackets(host) {
  return host.replace(/^\[|\]$/g, "");
}

/**
 * Normalize an IPv6 address to its canonical lowercase expanded form
 * (zero-padded 8 groups of 4 hex digits, ":" separated).
 *
 * @param {string} address
 * @returns {string | null} Normalised address or null if not valid IPv6.
 */
function normalizeIPv6(address) {
  // Strip brackets first (URL hostname may contain them)
  const raw = stripBrackets(address).toLowerCase();
  if (!net.isIPv6(raw)) return null;

  // Handle "::" compression
  const parts = raw.split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const missing = 8 - left.length - right.length;

  // Pad each group to 4 hex digits
  const expand = (arr) => arr.map((s) => s.padStart(4, "0"));
  const filled = [
    ...expand(left),
    ...Array.from({ length: missing }, () => "0000"),
    ...expand(right),
  ];

  return filled.join(":");
}

/**
 * Parse a normalized IPv6 string to an array of 8 16-bit integers.
 *
 * @param {string} normalized - Output of normalizeIPv6.
 * @returns {number[]}
 */
function ipv6ToWords(normalized) {
  return normalized.split(":").map((g) => parseInt(g, 16));
}

/**
 * Check whether a canonical IPv6 address falls inside any private / reserved
 * range.  Expects the output of `normalizeIPv6()`.
 *
 * @param {string} normalized - Canonical IPv6 address.
 * @returns {{ blocked: boolean, range?: string }}
 */
function checkPrivateIPv6Canonical(normalized) {
  const words = ipv6ToWords(normalized);

  // ::1/128  (loopback)
  if (
    words.slice(0, 7).every((w) => w === 0) &&
    words[7] === 1
  ) {
    return { blocked: true, range: "::1/128" };
  }

  // fc00::/7  (unique-local)
  if ((words[0] & 0xfe00) === 0xfc00) {
    return { blocked: true, range: "fc00::/7" };
  }

  // fe80::/10 (link-local)
  if ((words[0] & 0xffc0) === 0xfe80) {
    return { blocked: true, range: "fe80::/10" };
  }

  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:0:a.b.c.d) — words 0-4 = 0, word 5 = 0 or 0xffff
  // IPv4-compatible (::a.b.c.d) — words 0-5 = 0
  if (words.slice(0, 5).every((w) => w === 0)) {
    if (words[5] === 0xffff || words[5] === 0) {
      // Extract embedded IPv4 from words[6] and words[7]
      const hi = words[6];
      const lo = words[7];
      const embeddedIPv4 = [
        (hi >> 8) & 0xff,
        hi & 0xff,
        (lo >> 8) & 0xff,
        lo & 0xff,
      ].join(".");
      return checkPrivateIPv4(embeddedIPv4);
    }
  }

  return { blocked: false };
}

/**
 * Check whether `address` (IPv6 string) falls inside a reserved / private
 * range by normalising it first.
 *
 * Handles IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1) both in
 * dotted-quad form (pre-normalization) and hex form (post-normalization,
 * as produced by Node.js URL parser).
 *
 * @param {string} address - IPv6 string in any valid representation.
 * @returns {{ blocked: boolean, range?: string }}
 */
function checkPrivateIPv6(address) {
  const raw = stripBrackets(address).toLowerCase();
  if (!net.isIPv6(raw)) return { blocked: false };

  // Pre-normalization: detect IPv4-mapped in dotted-quad form
  // (e.g. ::ffff:192.168.1.1 passed directly, not through URL parser).
  const dotMatch = raw.match(IPV4_MAPPED_DOT_RE);
  if (dotMatch) {
    return checkPrivateIPv4(dotMatch[1]);
  }

  // Post-normalization: detect IPv4-mapped in hex form
  // (e.g. ::ffff:c0a8:101 produced by Node.js URL parser).
  const normalized = normalizeIPv6(address);
  if (!normalized) return { blocked: false };
  return checkPrivateIPv6Canonical(normalized);
}

// ---------------------------------------------------------------------------
// DNS resolution with timeout
// ---------------------------------------------------------------------------

/**
 * Resolve `hostname` to one or more IP addresses and reject any that map to
 * private / reserved ranges.  Throws on failure.
 *
 * DNS resolution has a configurable timeout (default DNS_TIMEOUT).
 *
 * @param {string} hostname
 * @param {number} [timeout] - Timeout in ms (default DNS_TIMEOUT).
 * @returns {Promise<string>} The first public IP found.
 */
function resolveAndValidateHost(hostname, timeout = DNS_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`DNS resolution timed out for ${hostname}`));
    }, timeout);

    dns.lookup(
      hostname,
      { all: true, family: 0, signal: controller.signal },
      (err, addresses) => {
        clearTimeout(timer);
        if (err) {
          if (err.name === "AbortError") return;
          return reject(
            new Error(`DNS resolution failed for ${hostname}: ${err.code || err.message}`),
          );
        }
        if (!addresses || addresses.length === 0) {
          return reject(
            new Error(`DNS resolution returned no addresses for ${hostname}`),
          );
        }

        for (const entry of addresses) {
          const addr = entry.address;
          if (entry.family === 4) {
            const v4 = checkPrivateIPv4(addr);
            if (v4.blocked) {
              return reject(
                new Error(
                  `Webhook URL resolves to private IPv4 range ${v4.range} (${addr}) — rejected`,
                ),
              );
            }
          } else if (entry.family === 6) {
            // dns.lookup returns canonical addresses
            const v6 = checkPrivateIPv6(addr);
            if (v6.blocked) {
              return reject(
                new Error(
                  `Webhook URL resolves to private IPv6 range ${v6.range} (${addr}) — rejected`,
                ),
              );
            }
          }
        }

        // All addresses are public – return the first one
        resolve(addresses[0].address);
      },
    );
  });
}

// Hostnames that are always considered private, regardless of DNS resolution.
// NOTE: stored without brackets; validateUrl strips brackets before comparing.
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254",
  "metadata.google.internal",
  "100.100.100.200", // Aliyun / others
]);

/**
 * Validate that `url` is safe to deliver a webhook to.  Throws on failure.
 *
 * Checks performed:
 * 1. URL parses correctly and uses http / https.
 * 2. Hostname is not a known-private literal.
 * 3. DNS resolves to at least one public IP address.
 *
 * @param {string} url - The webhook URL to validate.
 * @param {number} [dnsTimeout] - DNS lookup timeout in ms.
 * @returns {Promise<void>}
 */
async function validateUrl(url, dnsTimeout) {
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: "${url}"`);
  }

  if (!["http:", "https:"].includes(urlObj.protocol)) {
    throw new Error(`Webhook URL uses unsupported protocol "${urlObj.protocol}"`);
  }

  // Strip brackets from the hostname because Node.js URL parser may
  // leave them on for IPv6 literals.
  const host = stripBrackets(urlObj.hostname).toLowerCase();

  // Block IP-literal hostnames that we already know are private BEFORE DNS lookup.
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`Webhook URL uses blocked hostname "${host}"`);
  }

  // Block any IPv4 hostname that falls in a private range directly.
  if (net.isIPv4(host)) {
    const v4 = checkPrivateIPv4(host);
    if (v4.blocked) {
      throw new Error(`Webhook URL is a private IPv4 address (${v4.range})`);
    }
  }

  // Block any IPv6 hostname that falls in a private range directly (pre-DNS).
  // Also catches IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1).
  if (net.isIPv6(host)) {
    const v6 = checkPrivateIPv6(host);
    if (v6.blocked) {
      throw new Error(`Webhook URL is a private IPv6 address (${v6.range})`);
    }
  }

  // Resolve hostname and validate resolved IPs.
  await resolveAndValidateHost(host, dnsTimeout);
}

/**
 * POST a signed JSON payload to a webhook URL.
 * Resolves with the HTTP status code on success (2xx).
 * Rejects on network error, timeout, or non-2xx response.
 *
 * @param {string} url
 * @param {string} secret
 * @param {object} payload
 * @returns {Promise<number>}
 */
async function deliverPayload(url, secret, payload) {
  // Validate the URL before making any outbound request.
  await validateUrl(url);

  const body = JSON.stringify(payload);
  const signature = generateSignature(secret, body);

  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Webhook-Signature": signature,
    "User-Agent": "GreenPay-Webhook/1.0",
  };

  const { previousSecret, previousSecretExpiresAt, now = Date.now() } = options;
  if (previousSecret && typeof previousSecret === "string" && isGracePeriodActive(previousSecretExpiresAt, now)) {
    const previousSignature = generateSignature(previousSecret, body);
    headers["X-Webhook-Signature-Previous"] = previousSignature;
    headers["X-Webhook-Signature"] = `${signature}, ${previousSignature}`;
  }

  const urlObj = new URL(url);
  const reqOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: "POST",
    headers,
    timeout: 10000,
  };

  const lib = urlObj.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", () => {
        logger.info({
          event: "webhook_delivered",
          url,
          statusCode: res.statusCode,
          payload: { projectId: payload.projectId, milestone: payload.milestone },
        }, "Webhook delivered");
        resolve({ statusCode: res.statusCode });
      });
    });

    req.on("error", (err) => {
      logger.error({
        event: "webhook_delivery_error",
        url,
        err: err.message,
        payload: { projectId: payload.projectId, milestone: payload.milestone },
      }, "Webhook delivery failed");
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      logger.error({
        event: "webhook_timeout",
        url,
        payload: { projectId: payload.projectId, milestone: payload.milestone },
      }, "Webhook request timed out");
      reject(new Error("Webhook request timed out"));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Rotate webhook secret for a project.
 *
 * @param {string} projectId - Project UUID.
 * @param {object} [options]
 * @param {number} [options.gracePeriodMs=86400000] - Duration of grace period in ms.
 * @param {Date|number} [options.now] - Current time override.
 * @returns {Promise<object>} Secret rotation result.
 */
async function rotateWebhookSecret(projectId, options = {}) {
  const gracePeriodMs = options.gracePeriodMs || GRACE_PERIOD_MS;
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const rotatedAtDate = new Date(nowMs);
  const expiresAtDate = new Date(nowMs + gracePeriodMs);

  const projectResult = await pool.query(
    "SELECT id, webhook_secret, previous_webhook_secret FROM projects WHERE id = $1",
    [projectId]
  );

  const project = projectResult.rows[0];
  if (!project) {
    const err = new Error("Project not found");
    err.status = 404;
    throw err;
  }

  const oldSecret = project.webhook_secret || null;
  const newSecret = "whsec_" + crypto.randomBytes(24).toString("hex");

  const updateResult = await pool.query(
    `UPDATE projects
     SET webhook_secret = $1,
         previous_webhook_secret = $2,
         webhook_secret_rotated_at = $3,
         previous_webhook_secret_expires_at = $4,
         updated_at = NOW()
     WHERE id = $5
     RETURNING id, webhook_secret, previous_webhook_secret, webhook_secret_rotated_at, previous_webhook_secret_expires_at`,
    [
      newSecret,
      oldSecret,
      rotatedAtDate.toISOString(),
      oldSecret ? expiresAtDate.toISOString() : null,
      projectId,
    ]
  );

  const updated = updateResult.rows[0];
  const gracePeriodActive = isGracePeriodActive(updated.previous_webhook_secret_expires_at, nowMs);

  return {
    success: true,
    projectId,
    webhookSecret: updated.webhook_secret,
    rotatedAt: new Date(updated.webhook_secret_rotated_at).toISOString(),
    previousSecretExpiresAt: updated.previous_webhook_secret_expires_at
      ? new Date(updated.previous_webhook_secret_expires_at).toISOString()
      : null,
    expiresAt: updated.previous_webhook_secret_expires_at
      ? new Date(updated.previous_webhook_secret_expires_at).toISOString()
      : null,
    gracePeriodActive,
  };
}

/**
 * Check project milestones after a donation and deliver webhooks for any
 * newly reached milestones. Runs asynchronously (fire-and-forget enqueue).
 *
 * @param {string} projectId - Project UUID.
 */
async function checkAndDeliverMilestones(projectId) {
  try {
    const projectResult = await pool.query(
      `SELECT id, goal_xlm, raised_xlm, webhook_url, webhook_secret,
              previous_webhook_secret, previous_webhook_secret_expires_at
       FROM projects
       WHERE id = $1`,
      [projectId],
    );

    const project = projectResult.rows[0];
    if (!project) return;

    const goal = Number.parseFloat(project.goal_xlm);
    const raised = Number.parseFloat(project.raised_xlm);
    if (goal <= 0) return;

    const progressPercent = Math.min(Math.round((raised / goal) * 100), 100);

    const milestoneResult = await pool.query(
      `SELECT id, percentage, title
       FROM project_milestones
       WHERE project_id = $1
         AND percentage <= $2
         AND reached_at IS NULL
       ORDER BY percentage ASC`,
      [projectId, progressPercent],
    );

    const milestones = milestoneResult.rows;
    if (milestones.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const milestone of milestones) {
        await client.query(
          `UPDATE project_milestones
           SET reached_at = NOW()
           WHERE id = $1 AND project_id = $2 AND reached_at IS NULL`,
          [milestone.id, projectId],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ event: "milestone_update_error", projectId, err: err.message }, err.message);
      client.release();
      return;
    }
    client.release();

    if (project.webhook_url && project.webhook_secret) {
      // Fire all webhook deliveries concurrently so a slow DNS timeout on one
      // URL doesn't block the rest. Each attempt is persisted for history.
      const deliveries = milestones.map((milestone) => {
        const payload = {
          event: "milestone.reached",
          projectId,
          milestone: milestone.title,
          percentage: milestone.percentage,
          totalRaisedXLM: raised.toFixed(7),
          timestamp: new Date().toISOString(),
        };

        return recordAndDeliver({
          projectId,
          url: project.webhook_url,
          secret: project.webhook_secret,
          payload,
        }).catch((err) => {
          logger.error({
            event: "webhook_url_rejected",
            projectId,
            url: project.webhook_url,
            reason: err.message,
          }, "Skipping webhook delivery — URL rejected");
        });
      });

      await Promise.allSettled(deliveries);
    }
  } catch (err) {
    logger.error({
      event: "check_milestones_error",
      projectId,
      err: err.message,
    }, "Failed to check milestones");
  }
}

/**
 * No-op queue start — delivery history is recorded inline.
 * Kept so server.js can await start() without a separate pg-boss worker.
 * @returns {Promise<void>}
 */
async function start() {
  return;
}

module.exports = {
  checkAndDeliverMilestones,
  start,
  // Exported for unit testing
  validateUrl,
  checkPrivateIPv4,
  checkPrivateIPv6,
  normalizeIPv6,
  ip4ToInt,
  stripBrackets,
  PRIVATE_IPV4_RANGES,
  recordAndDeliver,
};

// Export internal functions for testing
if (process.env.NODE_ENV === "test") {
  module.exports.deliverPayload = deliverPayload;
}
