/**
 * src/routes/webhooks.js
 * GET /api/webhooks/:projectId — list configured webhook for a project (owner only)
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
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

/**
 * GET /api/webhooks/:projectId
 * Project owners can view their configured webhook URL and a masked secret.
 */
router.get("/:projectId", async (req, res, next) => {
  try {
    const walletAddress = getWalletAddressFromRequest(req);
    if (!walletAddress) {
      return res.status(401).json({ error: "X-Wallet-Address header is required" });
    }
    if (!STELLAR_ADDRESS_RE.test(walletAddress)) {
      return res.status(400).json({ error: "X-Wallet-Address must be a valid Stellar address" });
    }

    const projectResult = await pool.query(
      "SELECT id, wallet_address, webhook_url, webhook_secret FROM projects WHERE id = $1",
      [req.params.projectId],
    );
    const project = projectResult.rows[0];
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!isProjectOwner(req, project.wallet_address)) {
      return res.status(403).json({ error: "Only the project owner can view webhook configuration" });
    }

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
