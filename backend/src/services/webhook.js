/**
 * backend/src/services/webhook.js
 * Webhook delivery service for project milestone notifications.
 */
"use strict";

const crypto = require("crypto");
const dns = require("dns");
const net = require("net");
const https = require("https");
const http = require("http");
const pool = require("../db/pool");
const logger = require("../logger");

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
 * @param {string} url    - The webhook URL to deliver to.
 * @param {string} secret - HMAC-SHA256 secret for signing.
 * @param {object} payload - The JSON body to send.
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

  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Webhook-Signature": signature,
      "User-Agent": "GreenPay-Webhook/1.0",
    },
    timeout: 10000,
  };

  const lib = urlObj.protocol === "https:" ? https : http;

  const req = lib.request(options, (res) => {
    res.on("data", () => {});
    res.on("end", () => {
      logger.info({
        event: "webhook_delivered",
        url,
        statusCode: res.statusCode,
        payload: { projectId: payload.projectId, milestone: payload.milestone },
      }, "Webhook delivered");
    });
  });

  req.on("error", (err) => {
    logger.error({
      event: "webhook_delivery_error",
      url,
      err: err.message,
      payload: { projectId: payload.projectId, milestone: payload.milestone },
    }, "Webhook delivery failed");
  });

  req.on("timeout", () => {
    req.destroy();
    logger.error({
      event: "webhook_timeout",
      url,
      payload: { projectId: payload.projectId, milestone: payload.milestone },
    }, "Webhook request timed out");
  });

  req.write(body);
  req.end();
}

/**
 * Check project milestones after a donation and deliver webhooks for any
 * newly reached milestones. Runs asynchronously (fire-and-forget).
 *
 * @param {string} projectId - Project UUID.
 */
async function checkAndDeliverMilestones(projectId) {
  try {
    const projectResult = await pool.query(
      "SELECT id, goal_xlm, raised_xlm, webhook_url, webhook_secret FROM projects WHERE id = $1",
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
      for (const milestone of milestones) {
        const payload = {
          event: "milestone.reached",
          projectId,
          milestone: milestone.title,
          percentage: milestone.percentage,
          totalRaisedXLM: raised.toFixed(7),
          timestamp: new Date().toISOString(),
        };

        deliverPayload(project.webhook_url, project.webhook_secret, payload);
      }
    }
  } catch (err) {
    logger.error({
      event: "check_milestones_error",
      projectId,
      err: err.message,
    }, "Failed to check milestones");
  }
}

module.exports = {
  checkAndDeliverMilestones,
  deliverPayload,
  isPrivateIP,
};

