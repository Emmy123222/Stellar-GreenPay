/**
 * backend/src/services/webhook.js
 * Webhook delivery, secret rotation, and signature verification service for project milestone notifications.
 */
"use strict";

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const pool = require("../db/pool");
const logger = require("../logger");

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours in ms

/**
 * Constant-time string comparison using SHA-256 digest to prevent timing attacks.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/**
 * Generate HMAC-SHA256 signature hex for a given secret and payload.
 *
 * @param {string} secret
 * @param {string|object} payload
 * @returns {string} HMAC-SHA256 hex string
 */
function generateSignature(secret, payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Check whether the grace period is currently active for a previous secret.
 *
 * @param {string|Date|number} previousSecretExpiresAt
 * @param {string|Date|number} [now=Date.now()]
 * @returns {boolean}
 */
function isGracePeriodActive(previousSecretExpiresAt, now = Date.now()) {
  if (!previousSecretExpiresAt) return false;
  const expirationMs = new Date(previousSecretExpiresAt).getTime();
  if (Number.isNaN(expirationMs)) return false;
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  return expirationMs > nowMs;
}

/**
 * Verify incoming webhook signature against current secret and (if in grace period) previous secret.
 *
 * @param {string|object} payload - Webhook payload object or string.
 * @param {string|string[]|object} signatureInput - Signature string, array of strings, comma-separated string, or headers object.
 * @param {string} currentSecret - Current active webhook secret.
 * @param {object} [options]
 * @param {string} [options.previousSecret] - Previous webhook secret before rotation.
 * @param {string|Date|number} [options.previousSecretExpiresAt] - Grace period expiration timestamp.
 * @param {string|Date|number} [options.now] - Time override for testing.
 * @returns {boolean} True if signature is valid.
 */
function verifyWebhookSignature(payload, signatureInput, currentSecret, options = {}) {
  if (!signatureInput || !currentSecret || typeof currentSecret !== "string") return false;

  const { previousSecret, previousSecretExpiresAt, now = Date.now() } = options;

  let candidateSignatures = [];
  if (typeof signatureInput === "string") {
    candidateSignatures = signatureInput.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(signatureInput)) {
    candidateSignatures = signatureInput.filter((s) => typeof s === "string" && s.trim());
  } else if (typeof signatureInput === "object") {
    const mainSig = signatureInput["x-webhook-signature"] || signatureInput["X-Webhook-Signature"];
    const prevSig = signatureInput["x-webhook-signature-previous"] || signatureInput["X-Webhook-Signature-Previous"];
    if (mainSig) candidateSignatures.push(...mainSig.split(",").map((s) => s.trim()));
    if (prevSig) candidateSignatures.push(...prevSig.split(",").map((s) => s.trim()));
  }

  if (candidateSignatures.length === 0) return false;

  const expectedCurrentSig = generateSignature(currentSecret, payload);
  for (const sig of candidateSignatures) {
    if (timingSafeEqualHex(sig, expectedCurrentSig)) {
      return true;
    }
  }

  if (previousSecret && typeof previousSecret === "string" && isGracePeriodActive(previousSecretExpiresAt, now)) {
    const expectedPrevSig = generateSignature(previousSecret, payload);
    for (const sig of candidateSignatures) {
      if (timingSafeEqualHex(sig, expectedPrevSig)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * POST a signed JSON payload to a webhook URL.
 * Supports dual-signature signing during the 24-hour grace period.
 *
 * @param {string} url - The webhook URL to deliver to.
 * @param {string} secret - Primary (current) secret for signing.
 * @param {object} payload - The JSON body to send.
 * @param {object} [options] - Rotation options (previousSecret, previousSecretExpiresAt, now).
 */
function deliverPayload(url, secret, payload, options = {}) {
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

  const req = lib.request(reqOptions, (res) => {
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
 * newly reached milestones. Runs asynchronously (fire-and-forget).
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
      for (const milestone of milestones) {
        const payload = {
          event: "milestone.reached",
          projectId,
          milestone: milestone.title,
          percentage: milestone.percentage,
          totalRaisedXLM: raised.toFixed(7),
          timestamp: new Date().toISOString(),
        };

        deliverPayload(project.webhook_url, project.webhook_secret, payload, {
          previousSecret: project.previous_webhook_secret,
          previousSecretExpiresAt: project.previous_webhook_secret_expires_at,
        });
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
  generateSignature,
  isGracePeriodActive,
  verifyWebhookSignature,
  rotateWebhookSecret,
  timingSafeEqualHex,
  GRACE_PERIOD_MS,
};
