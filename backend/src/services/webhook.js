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
const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");

const QUEUE = "webhook-delivery";
const MAX_ATTEMPTS = 5;
/** Delay (seconds) before the next attempt after failures 1–4. */
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200]; // 1m, 5m, 30m, 2h

let boss = null;

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
function deliverPayload(url, secret, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (err) {
      reject(new Error(`Invalid webhook URL: ${err.message}`));
      return;
    }

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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.statusCode);
        } else {
          reject(new Error(`Webhook responded with HTTP ${res.statusCode}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Webhook request timed out"));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Schedule (or immediately enqueue) a delivery job via pg-boss.
 *
 * @param {string} deliveryId
 * @param {number} [startAfterSeconds=0]
 */
async function scheduleDeliveryJob(deliveryId, startAfterSeconds = 0) {
  if (!boss) {
    logger.warn(
      { event: "webhook_queue_not_started", deliveryId },
      "webhook queue not started; delivery will not be scheduled",
    );
    return null;
  }

  const options = {};
  if (startAfterSeconds > 0) {
    options.startAfter = startAfterSeconds;
  }

  return boss.send(QUEUE, { deliveryId }, options);
}

/**
 * Persist a pending delivery row and enqueue the first attempt immediately.
 *
 * @param {{ projectId: string, url: string, payload: object }} opts
 * @returns {Promise<string>} delivery id
 */
async function enqueueWebhookDelivery({ projectId, url, payload }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO webhook_deliveries (id, project_id, url, payload, status, attempt_count)
     VALUES ($1, $2, $3, $4::jsonb, 'pending', 0)`,
    [id, projectId, url, JSON.stringify(payload)],
  );

  await scheduleDeliveryJob(id, 0);
  return id;
}

/**
 * Process one webhook delivery job: attempt HTTP POST, then mark delivered
 * or schedule the next retry / mark failed.
 *
 * @param {{ data: { deliveryId: string } }} job
 */
async function processDeliveryJob(job) {
  const { deliveryId } = job.data || {};
  if (!deliveryId) return;

  const result = await pool.query(
    `SELECT d.*, p.webhook_secret
       FROM webhook_deliveries d
       LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1`,
    [deliveryId],
  );

  const row = result.rows[0];
  if (!row) {
    logger.warn({ event: "webhook_delivery_missing", deliveryId }, "Delivery row not found");
    return;
  }

  if (row.status === "delivered" || row.status === "failed") {
    return;
  }

  if (!row.webhook_secret) {
    await pool.query(
      `UPDATE webhook_deliveries
          SET status = 'failed',
              last_error = $1,
              last_attempt_at = NOW(),
              attempt_count = attempt_count + 1
        WHERE id = $2`,
      ["Project webhook_secret missing", deliveryId],
    );
    logger.error({
      event: "webhook_delivery_failed",
      deliveryId,
      reason: "missing_secret",
    }, "Webhook delivery failed permanently");
    return;
  }

  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  const nextAttempt = row.attempt_count + 1;

  try {
    const statusCode = await deliverPayload(row.url, row.webhook_secret, payload);

    await pool.query(
      `UPDATE webhook_deliveries
          SET status = 'delivered',
              attempt_count = $1,
              last_error = NULL,
              last_attempt_at = NOW(),
              delivered_at = NOW(),
              next_attempt_at = NULL
        WHERE id = $2`,
      [nextAttempt, deliveryId],
    );

    logger.info({
      event: "webhook_delivered",
      deliveryId,
      url: row.url,
      statusCode,
      attempt: nextAttempt,
      payload: { projectId: payload.projectId, milestone: payload.milestone },
    }, "Webhook delivered");
  } catch (err) {
    const errorMessage = err.message || String(err);

    if (nextAttempt >= MAX_ATTEMPTS) {
      await pool.query(
        `UPDATE webhook_deliveries
            SET status = 'failed',
                attempt_count = $1,
                last_error = $2,
                last_attempt_at = NOW(),
                next_attempt_at = NULL
          WHERE id = $3`,
        [nextAttempt, errorMessage, deliveryId],
      );

      logger.error({
        event: "webhook_delivery_failed",
        deliveryId,
        url: row.url,
        attempt: nextAttempt,
        err: errorMessage,
        payload: { projectId: payload.projectId, milestone: payload.milestone },
      }, "Webhook delivery failed after max attempts");
      return;
    }

    const delaySeconds = RETRY_DELAYS_SECONDS[nextAttempt - 1] || RETRY_DELAYS_SECONDS[RETRY_DELAYS_SECONDS.length - 1];

    await pool.query(
      `UPDATE webhook_deliveries
          SET status = 'pending',
              attempt_count = $1,
              last_error = $2,
              last_attempt_at = NOW(),
              next_attempt_at = NOW() + ($3 || ' seconds')::interval
        WHERE id = $4`,
      [nextAttempt, errorMessage, String(delaySeconds), deliveryId],
    );

    await scheduleDeliveryJob(deliveryId, delaySeconds);

    logger.error({
      event: "webhook_delivery_retry_scheduled",
      deliveryId,
      url: row.url,
      attempt: nextAttempt,
      nextDelaySeconds: delaySeconds,
      err: errorMessage,
      payload: { projectId: payload.projectId, milestone: payload.milestone },
    }, "Webhook delivery failed; retry scheduled");
  }
}

/**
 * Start the pg-boss worker that processes webhook delivery jobs.
 * Must be called after database migrations.
 */
async function start() {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("[webhookQueue] pg-boss error:", err.message));

  await boss.start();
  await boss.work(QUEUE, { teamSize: 2, teamConcurrency: 1 }, processDeliveryJob);

  console.log("[webhookQueue] pg-boss started, worker registered on queue:", QUEUE);
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

        await enqueueWebhookDelivery({
          projectId,
          url: project.webhook_url,
          payload,
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
  start,
  checkAndDeliverMilestones,
  deliverPayload,
  enqueueWebhookDelivery,
  processDeliveryJob,
  scheduleDeliveryJob,
  MAX_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
  QUEUE,
};
