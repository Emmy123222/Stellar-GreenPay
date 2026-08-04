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
const net = require("net");
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
 * Check whether an IP address falls within loopback, private, or link-local ranges.
 *
 * Blocked ranges:
 * - 127.0.0.0/8 (loopback)
 * - 10.0.0.0/8 (private)
 * - 172.16.0.0/12 (private)
 * - 192.168.0.0/16 (private)
 * - 169.254.0.0/16 (link-local / cloud metadata)
 * - 0.0.0.0/8 (unspecified / broadcast)
 * - IPv6 loopback (::1, ::), link-local (fe80::/10), unique local (fc00::/7)
 *
 * @param {string} ip - IP address string.
 * @returns {boolean} True if private or restricted IP.
 */
function isPrivateIP(ip) {
  if (!ip || typeof ip !== "string") return true;

  let normalizedIp = ip.trim();

  // Handle IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1)
  if (normalizedIp.toLowerCase().startsWith("::ffff:")) {
    normalizedIp = normalizedIp.substring(7);
  }

  if (net.isIPv4(normalizedIp)) {
    const parts = normalizedIp.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    // 10.0.0.0/8 (private)
    if (a === 10) return true;
    // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (private)
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (link-local / cloud metadata)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0/8 (current network / loopback route)
    if (a === 0) return true;

    return false;
  }

  if (net.isIPv6(normalizedIp)) {
    const lower = normalizedIp.toLowerCase();
    // IPv6 Loopback (::1 or ::)
    if (lower === "::1" || lower === "::" || lower === "0:0:0:0:0:0:0:1" || lower === "0:0:0:0:0:0:0:0") {
      return true;
    }
    // Unique local addresses (fc00::/7)
    if (lower.startsWith("fc") || lower.startsWith("fd")) {
      return true;
    }
    // Link-local addresses (fe80::/10)
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * POST a signed JSON payload to a webhook URL.
 * Resolves the hostname via DNS first to ensure the IP does not belong to private/restricted ranges.
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
async function deliverPayload(url, secret, payload) {
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (err) {
    logger.error({
      event: "webhook_delivery_error",
      url,
      err: err.message,
      payload: { projectId: payload?.projectId, milestone: payload?.milestone },
    }, "Webhook delivery failed: Invalid URL");
    return;
  }

  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    logger.error({
      event: "webhook_delivery_error",
      url,
      err: `Unsupported protocol: ${urlObj.protocol}`,
      payload: { projectId: payload?.projectId, milestone: payload?.milestone },
    }, "Webhook delivery failed: Unsupported protocol");
    return;
  }

  let addresses;
  try {
    addresses = await dns.promises.lookup(urlObj.hostname, { all: true });
  } catch (err) {
    logger.error({
      event: "webhook_delivery_error",
      url,
      err: `DNS resolution failed for ${urlObj.hostname}: ${err.message}`,
      payload: { projectId: payload?.projectId, milestone: payload?.milestone },
    }, "Webhook delivery failed: DNS resolution error");
    return;
  }

  if (!addresses || addresses.length === 0) {
    logger.error({
      event: "webhook_delivery_error",
      url,
      err: `No IP addresses resolved for ${urlObj.hostname}`,
      payload: { projectId: payload?.projectId, milestone: payload?.milestone },
    }, "Webhook delivery failed: No IP addresses resolved");
    return;
  }

  for (const entry of addresses) {
    if (isPrivateIP(entry.address)) {
      logger.error({
        event: "webhook_delivery_error",
        url,
        ip: entry.address,
        err: `Blocked SSRF target IP: ${entry.address}`,
        payload: { projectId: payload?.projectId, milestone: payload?.milestone },
      }, "Webhook delivery failed: Blocked private or restricted IP address");
      return;
    }
  }

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

  const options = {
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
  deliverPayload,
  isPrivateIP,
};

// Export internal functions for testing
if (process.env.NODE_ENV === "test") {
  module.exports.deliverPayload = deliverPayload;
}
