/**
 * src/routes/projectPreferredAsset.js — per-project preferred receive asset (#1660)
 *
 * GET /api/projects/:id/preferred-asset   — public
 * PUT /api/projects/:id/preferred-asset   — project owner (wallet JWT) or admin
 *     body: { preferredAsset: { code, issuer } | null }   (null = native XLM)
 *
 * When set, DonateForm sends donors holding another asset through a DEX path
 * payment, and POST /api/donations verifies the project received this asset.
 */
"use strict";
const express = require("express");
const router = express.Router({ mergeParams: true });
const pool = require("../db/pool");
const redis = require("../services/redis");
const { walletOrAdminRequired } = require("../middleware/auth");
const { validatePreferredAsset, DeliveryVerificationError } = require("../services/pathPayment");

function toResponse(row) {
  return row.preferred_asset_code
    ? { code: row.preferred_asset_code, issuer: row.preferred_asset_issuer }
    : null;
}

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT preferred_asset_code, preferred_asset_issuer FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Project not found" });
    res.json({ success: true, data: { preferredAsset: toResponse(result.rows[0]) } });
  } catch (e) {
    next(e);
  }
});

router.put("/", walletOrAdminRequired, async (req, res, next) => {
  try {
    let preferredAsset;
    try {
      preferredAsset = validatePreferredAsset(req.body ? req.body.preferredAsset : undefined);
    } catch (err) {
      if (err instanceof DeliveryVerificationError) return res.status(400).json({ error: err.message });
      throw err;
    }

    const projectResult = await pool.query("SELECT wallet_address FROM projects WHERE id = $1", [req.params.id]);
    const project = projectResult.rows[0];
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!req.admin && req.walletAddress !== project.wallet_address) {
      return res.status(403).json({ error: "Only the project owner can change the preferred asset" });
    }

    const result = await pool.query(
      `UPDATE projects
       SET preferred_asset_code = $1, preferred_asset_issuer = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING preferred_asset_code, preferred_asset_issuer`,
      [preferredAsset ? preferredAsset.code : null, preferredAsset ? preferredAsset.issuer : null, req.params.id],
    );

    // Project detail/list responses embed preferredAsset.
    if (typeof redis.deletePattern === "function") {
      await redis.deletePattern("projects:list:*");
      await redis.deletePattern(`projects:detail:${req.params.id}*`);
    }

    res.json({ success: true, data: { preferredAsset: toResponse(result.rows[0]) } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
