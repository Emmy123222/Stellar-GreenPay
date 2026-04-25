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
    const period = req.query.period || "all";

    let dateFilter = "";
    if (period === "month") {
      dateFilter = "AND d.created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === "year") {
      dateFilter = "AND d.created_at >= NOW() - INTERVAL '1 year'";
    }

    const result = await pool.query(
      `SELECT p.public_key, p.display_name, p.badges,
              COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_donated_xlm,
              COUNT(DISTINCT d.project_id)::INTEGER AS projects_supported
       FROM profiles p
       LEFT JOIN donations d ON p.public_key = d.donor_address
       ${dateFilter}
       GROUP BY p.public_key, p.display_name, p.badges
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
