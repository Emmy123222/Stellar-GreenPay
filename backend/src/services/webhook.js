/**
 * backend/src/services/webhook.js
 * Webhook delivery service for project milestone notifications.
 *
 * Deliveries are persisted in `webhook_deliveries`. The first attempt runs
 * inline via recordAndDeliver(); failures leave the row `pending` with
 * `next_attempt_at` set, and a pg-boss worker (start()) drains due retries
 * with exponential backoff at 1m, 5m, 30m, 2h. A delivery is marked `failed`
 * once MAX_ATTEMPTS attempts have been made, or immediately when the failure
 * is permanent (for example an SSRF-rejected URL).
 */
"use strict";

const crypto = require("crypto");
const PgBoss = require("pg-boss");
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
/** Retry worker tick. Must be at least as frequent as the shortest backoff. */
const DEFAULT_RETRY_CRON = "* * * * *";

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
 * Seconds to wait before the next attempt, given how many attempts have
 * already failed. Returns null once the budget is exhausted.
 *
 * @param {number} failedAttempts - Number of attempts made so far (1-based).
 * @returns {number|null} Delay in seconds, or null when no retry is left.
 */
function retryDelaySeconds(failedAttempts) {
  if (failedAttempts >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_SECONDS[failedAttempts - 1] ?? null;
}

/**
 * Write the outcome of a single delivery attempt to the delivery row.
 *
 * A failure that still has retry budget leaves the row `pending` with
 * `next_attempt_at` set, which is what `processDueRetries` picks up. A failure
 * with no budget left — or a permanent one, such as an SSRF-rejected URL that
 * will never become deliverable — is terminal and marked `failed`.
 *
 * @param {object} outcome
 * @param {string} outcome.id - Delivery row id.
 * @param {number} outcome.attemptNumber - The attempt that just completed (1-based).
 * @param {boolean} outcome.delivered - Whether the endpoint accepted the payload.
 * @param {number|null} [outcome.statusCode] - HTTP status, when there was a response.
 * @param {string|null} [outcome.error] - Failure message to persist.
 * @param {boolean} [outcome.permanent] - Skip remaining retries.
 * @returns {Promise<{status: string, nextAttemptInSeconds: number|null}>}
 */
async function recordAttemptOutcome({
  id,
  attemptNumber,
  delivered,
  statusCode = null,
  error = null,
  permanent = false,
}) {
  if (delivered) {
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'delivered',
           attempt_count = $2,
           last_attempt_at = NOW(),
           response_status = $3,
           delivered_at = NOW(),
           last_error = NULL,
           next_attempt_at = NULL
       WHERE id = $1`,
      [id, attemptNumber, statusCode],
    );
    return { status: "delivered", nextAttemptInSeconds: null };
  }

  const delaySeconds = permanent ? null : retryDelaySeconds(attemptNumber);

  if (delaySeconds === null) {
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'failed',
           attempt_count = $2,
           last_attempt_at = NOW(),
           response_status = $3,
           last_error = $4,
           next_attempt_at = NULL
       WHERE id = $1`,
      [id, attemptNumber, statusCode, error],
    );
    logger.warn(
      { event: "webhook_delivery_exhausted", deliveryId: id, attempts: attemptNumber, permanent },
      "Webhook delivery failed permanently — no further retries",
    );
    return { status: "failed", nextAttemptInSeconds: null };
  }

  await pool.query(
    `UPDATE webhook_deliveries
     SET status = 'pending',
         attempt_count = $2,
         last_attempt_at = NOW(),
         response_status = $3,
         last_error = $4,
         next_attempt_at = NOW() + ($5 * INTERVAL '1 second')
     WHERE id = $1`,
    [id, attemptNumber, statusCode, error, delaySeconds],
  );
  logger.info(
    { event: "webhook_retry_scheduled", deliveryId: id, attempt: attemptNumber, delaySeconds },
    `Webhook attempt ${attemptNumber} failed — retrying in ${delaySeconds}s`,
  );
  return { status: "pending", nextAttemptInSeconds: delaySeconds };
}

/**
 * Run one delivery attempt against an existing delivery row and persist the
 * outcome. Rethrows transport-level errors so callers can log them; status is
 * already recorded by the time the error propagates.
 *
 * @param {object} attempt
 * @param {string} attempt.id - Delivery row id.
 * @param {string} attempt.url - Destination URL.
 * @param {string} attempt.secret - Current signing secret.
 * @param {object} attempt.payload - Webhook body.
 * @param {number} attempt.previousAttempts - Attempts already recorded on the row.
 * @param {object} [attempt.options] - Passed through to deliverPayload.
 * @returns {Promise<{status: string, nextAttemptInSeconds: number|null}>}
 */
async function attemptDelivery({ id, url, secret, payload, previousAttempts, options = {} }) {
  const attemptNumber = previousAttempts + 1;

  // A URL that fails SSRF validation is never going to become deliverable, so
  // it burns no retry budget.
  try {
    await assertPublicHttpUrl(url);
  } catch (err) {
    await recordAttemptOutcome({
      id,
      attemptNumber,
      delivered: false,
      error: err.message,
      permanent: true,
    });
    throw err;
  }

  try {
    const { statusCode } = await deliverPayload(url, secret, payload, options);
    const delivered = statusCode >= 200 && statusCode < 300;
    return await recordAttemptOutcome({
      id,
      attemptNumber,
      delivered,
      statusCode,
      error: delivered ? null : `Webhook responded with HTTP ${statusCode}`,
    });
  } catch (err) {
    await recordAttemptOutcome({
      id,
      attemptNumber,
      delivered: false,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Persist a delivery row and make the first attempt. Subsequent attempts are
 * driven by `processDueRetries`.
 *
 * @param {{ projectId: string, url: string, secret: string, payload: object, options?: object }} opts
 * @returns {Promise<{status: string, nextAttemptInSeconds: number|null}>}
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

  return attemptDelivery({ id, url, secret, payload, previousAttempts: 0, options });
}

/**
 * Re-attempt every delivery whose `next_attempt_at` has come due.
 *
 * The signing secret is read from the project at retry time rather than stored
 * on the delivery row, so a rotated secret is picked up by pending retries.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=50] - Maximum deliveries to process in one pass.
 * @returns {Promise<Array<{id: string, status: string}>>}
 */
async function processDueRetries({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT d.id, d.url, d.payload, d.attempt_count,
            p.webhook_secret,
            p.previous_webhook_secret,
            p.previous_webhook_secret_expires_at
     FROM webhook_deliveries d
     JOIN projects p ON p.id = d.project_id
     WHERE d.status = 'pending'
       AND d.next_attempt_at IS NOT NULL
       AND d.next_attempt_at <= NOW()
     ORDER BY d.next_attempt_at ASC
     LIMIT $1`,
    [limit],
  );

  const results = [];

  for (const row of rows) {
    if (!row.webhook_secret) {
      await recordAttemptOutcome({
        id: row.id,
        attemptNumber: row.attempt_count,
        delivered: false,
        error: "Project has no webhook secret configured",
        permanent: true,
      });
      results.push({ id: row.id, status: "failed" });
      continue;
    }

    const payload =
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;

    try {
      const outcome = await attemptDelivery({
        id: row.id,
        url: row.url,
        secret: row.webhook_secret,
        payload,
        previousAttempts: row.attempt_count,
        options: {
          previousSecret: row.previous_webhook_secret,
          previousSecretExpiresAt: row.previous_webhook_secret_expires_at,
        },
      });
      results.push({ id: row.id, status: outcome.status });
    } catch (err) {
      // Outcome is already persisted by attemptDelivery; keep draining the batch.
      logger.error(
        { event: "webhook_retry_error", deliveryId: row.id, err: err.message },
        "Webhook retry attempt failed",
      );
      results.push({ id: row.id, status: "error" });
    }
  }

  return results;
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
 * Start the webhook retry worker.
 *
 * Registers a pg-boss cron job that drains due retries. Schedule is every
 * minute by default — the shortest backoff step is 1 minute, so a coarser
 * tick would delay the first retry. Override with WEBHOOK_RETRY_CRON, or set
 * it to "disabled" to turn retries off entirely.
 *
 * Safe to call more than once; guards on the module-level `boss`.
 *
 * @returns {Promise<void>}
 */
async function start() {
  const cronOverride = process.env.WEBHOOK_RETRY_CRON;
  if (cronOverride === "disabled") {
    logger.info(
      { event: "webhook_retry_disabled" },
      "[webhook] Retry worker disabled via WEBHOOK_RETRY_CRON",
    );
    return;
  }

  if (boss) return;

  const cronSchedule = cronOverride || DEFAULT_RETRY_CRON;
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) =>
    logger.error({ event: "webhook_retry_pgboss_error", err }, err.message),
  );

  await boss.start();
  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await processDueRetries();
  });

  logger.info(
    { event: "webhook_retry_scheduled_worker", cron: cronSchedule },
    `[webhook] Retry worker scheduled: ${cronSchedule}`,
  );
}

module.exports = {
  checkAndDeliverMilestones,
  deliverPayload,
  start,
  recordAndDeliver,
  attemptDelivery,
  recordAttemptOutcome,
  processDueRetries,
  retryDelaySeconds,
  generateSignature,
  isGracePeriodActive,
  verifyWebhookSignature,
  rotateWebhookSecret,
  timingSafeEqualHex,
  GRACE_PERIOD_MS,
  QUEUE,
  MAX_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
  DEFAULT_RETRY_CRON,
  boss,
};
