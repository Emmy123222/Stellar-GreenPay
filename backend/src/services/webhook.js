/**
 * backend/src/services/webhook.js
 * Webhook delivery service for project milestone notifications.
 */
"use strict";

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const pool = require("../db/pool");
const logger = require("../logger");

/**
 * POST a signed JSON payload to a webhook URL.
 *
 * @param {string} url    - The webhook URL to deliver to.
 * @param {string} secret - HMAC-SHA256 secret for signing.
 * @param {object} payload - The JSON body to send.
 */
function deliverPayload(url, secret, payload) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  const urlObj = new URL(url);
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
};
