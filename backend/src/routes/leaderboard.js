/**
 * src/routes/leaderboard.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool = require("../db/pool");

router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const result = await pool.query(
      `SELECT public_key, display_name, total_donated_xlm, projects_supported, badges
       FROM profiles
       ORDER BY total_donated_xlm DESC
       LIMIT $1`,
      [limit],
    );
    const entries = result.rows.map((p, i) => ({
      rank: i + 1,
      publicKey: p.public_key,
      displayName: p.display_name || null,
      totalDonatedXLM: p.total_donated_xlm?.toString() || "0",
      projectsSupported: p.projects_supported,
      topBadge: p.badges?.[0]?.tier || null,
    }));
    res.json({ success: true, data: entries });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
