/**
 * backend/src/services/webhook.js
 * Webhook delivery service for project milestone notifications.
 *
 * Deliveries are persisted in `webhook_deliveries` and processed via pg-boss
 * with exponential backoff: retry at 1m, 5m, 30m, 2h. Marked failed after 5 attempts.
 */
"use strict";

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const pool = require("../db/pool");
const logger = require("../logger");
const { assertPublicHttpUrl } = require("../utils/ssrf");

const QUEUE = "webhook-delivery";
const MAX_ATTEMPTS = 5;
/** Delay (seconds) before the next attempt after failures 1–4. */
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200]; // 1m, 5m, 30m, 2h
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

let boss = null;

function generateSignature(secret, body) {
  return crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
}

function isGracePeriodActive(expiresAt, nowMs) {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt).getTime();
  return !isNaN(expiry) && nowMs < expiry;
}

function timingSafeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

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
 * Resolves with the HTTP status code on success (2xx).
 * Rejects on network error, timeout, or non-2xx response.
 *
 * @param {string} url
 * @param {string} secret
 * @param {object} payload
 * @param {object} [options]
 * @returns {Promise<number>}
 */
async function deliverPayload(url, secret, payload, options = {}) {
  // Validate the URL before making any outbound request.
  await assertPublicHttpUrl(url);

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
    const req = lib.request(reqOptions, (res) => {
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
 * Persist a delivery row, attempt the HTTP POST, then update status/history fields.
 *
 * @param {{ projectId: string, url: string, secret: string, payload: object, options?: object }} opts
 * @returns {Promise<void>}
 */
async function recordAndDeliver({ projectId, url, secret, payload, options = {} }) {
  const id = crypto.randomUUID();
  const body = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");
  const event = typeof payload?.event === "string" ? payload.event : null;

  await pool.query(
    `INSERT INTO webhook_deliveries (
       id, project_id, url, payload, event, payload_hash, status, attempt_count
     ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'pending', 0)`,
    [id, projectId, url, body, event, payloadHash],
  );

  try {
    const { statusCode } = await deliverPayload(url, secret, payload, options);
    const delivered = statusCode >= 200 && statusCode < 300;
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = $2,
           attempt_count = 1,
           last_attempt_at = NOW(),
           response_status = $3,
           delivered_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
           last_error = CASE WHEN $4 THEN NULL ELSE $5 END,
           next_attempt_at = NULL
       WHERE id = $1`,
      [
        id,
        delivered ? "delivered" : "failed",
        statusCode,
        delivered,
        delivered ? null : `Webhook responded with HTTP ${statusCode}`,
      ],
    );
  } catch (err) {
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'failed',
           attempt_count = 1,
           last_attempt_at = NOW(),
           last_error = $2,
           next_attempt_at = NULL
       WHERE id = $1`,
      [id, err.message],
    );
    throw err;
  }
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

    if (project.webhook_url && project.webhook_secret &&
        project.webhook_secret.length >= 32) {
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
          options: {
            previousSecret: project.previous_webhook_secret,
            previousSecretExpiresAt: project.previous_webhook_secret_expires_at,
          }
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
  start,
  recordAndDeliver,
  generateSignature,
  isGracePeriodActive,
  verifyWebhookSignature,
  rotateWebhookSecret,
  timingSafeEqualHex,
  GRACE_PERIOD_MS,
  QUEUE,
  MAX_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
  boss,
};
