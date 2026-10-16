/**
 * src/routes/webhooks.js
 * GET /api/webhooks/:projectId — list configured webhook for a project (owner only)
 * GET /api/webhooks/:projectId/history — paginated delivery history (owner only)
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { deliverPayload } = require("../services/webhook");
const {
  STELLAR_ADDRESS_RE,
  getWalletAddressFromRequest,
  isProjectOwner,
} = require("../middleware/projectOwner");

function maskWebhookSecret(secret) {
  if (!secret || typeof secret !== "string") {
    return null;
  }

  if (secret.length <= 4) {
    return "****";
  }

  const visible = secret.slice(-4);
  const maskedLength = Math.min(secret.length - 4, 12);
  return `${"*".repeat(maskedLength)}${visible}`;
}

function mapDeliveryRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    event: row.event || null,
    payloadHash: row.payload_hash || null,
    status: row.status,
    attempts: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    responseStatus: row.response_status ?? null,
    lastError: row.last_error || null,
    deliveredAt: row.delivered_at || null,
    createdAt: row.created_at,
  };
}

/**
 * Ensure the caller is the project owner. Returns the project row or sends an
 * error response and returns null.
 */
async function requireProjectOwner(req, res) {
  const walletAddress = getWalletAddressFromRequest(req);
  if (!walletAddress) {
    res.status(401).json({ error: "X-Wallet-Address header is required" });
    return null;
  }
  if (!STELLAR_ADDRESS_RE.test(walletAddress)) {
    res.status(400).json({ error: "X-Wallet-Address must be a valid Stellar address" });
    return null;
  }

  const projectResult = await pool.query(
    "SELECT id, wallet_address, webhook_url, webhook_secret FROM projects WHERE id = $1",
    [req.params.projectId],
  );
  const project = projectResult.rows[0];
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  if (!isProjectOwner(req, project.wallet_address)) {
    res.status(403).json({ error: "Only the project owner can view webhook configuration" });
    return null;
  }

  return project;
}

/**
 * GET /api/webhooks/:projectId/history
 * Paginated list of recent webhook delivery attempts for a project.
 */
router.get("/:projectId/history", async (req, res, next) => {
  try {
    const project = await requireProjectOwner(req, res);
    if (!project) return;

    const page = Math.max(Number.parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(Number.parseInt(String(req.query.pageSize || "20"), 10) || 20, 1),
      100,
    );
    const offset = (page - 1) * pageSize;

    const [listResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, project_id, event, payload_hash, status, attempt_count,
                last_attempt_at, next_attempt_at, response_status, last_error,
                delivered_at, created_at
         FROM webhook_deliveries
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [project.id, pageSize, offset],
      ),
      pool.query(
        "SELECT COUNT(*)::int AS total FROM webhook_deliveries WHERE project_id = $1",
        [project.id],
      ),
    ]);

    res.json({
      success: true,
      data: listResult.rows.map(mapDeliveryRow),
      total: countResult.rows[0]?.total || 0,
      page,
      pageSize,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/webhooks/:projectId/test
 * Send a signed test event to the project's configured webhook URL.
 */
router.patch("/:projectId/test", async (req, res, next) => {
  try {
    const project = await requireProjectOwner(req, res);
    if (!project) return;
    if (!project.webhook_url || !project.webhook_secret) {
      return res.status(400).json({ error: "Webhook is not configured for this project" });
    }

    const payload = {
      event: "webhook.test",
      projectId: project.id,
      sentAt: new Date().toISOString(),
    };
    const { statusCode } = await deliverPayload(
      project.webhook_url,
      project.webhook_secret,
      payload,
    );

    if (statusCode < 200 || statusCode >= 300) {
      return res.status(502).json({
        error: "Test webhook endpoint returned a non-success status",
        responseStatus: statusCode,
      });
    }

    res.json({ success: true, responseStatus: statusCode });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/webhooks/:projectId
 * Project owners can view their configured webhook URL and a masked secret.
 */
router.get("/:projectId", async (req, res, next) => {
  try {
    const project = await requireProjectOwner(req, res);
    if (!project) return;

    const configured = Boolean(project.webhook_url);

    res.json({
      success: true,
      data: {
        projectId: project.id,
        webhookUrl: project.webhook_url || null,
        webhookSecretMasked: configured ? maskWebhookSecret(project.webhook_secret) : null,
        configured,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
