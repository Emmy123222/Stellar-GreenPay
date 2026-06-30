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

    const onlyVerified = req.query.onlyVerified === "true";

    let query = `
      SELECT p.public_key, p.display_name, p.badges,
             COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_donated_xlm,
             COUNT(DISTINCT d.project_id)::INTEGER AS projects_supported
      FROM profiles p
      LEFT JOIN donations d ON p.public_key = d.donor_address
    `;

    if (period === "month") {
      query += " AND d.created_at >= NOW() - INTERVAL '30 days' ";
    } else if (period === "year") {
      query += " AND d.created_at >= NOW() - INTERVAL '1 year' ";
    }

    if (onlyVerified) {
      query += `
        WHERE NOT EXISTS (
          SELECT 1 FROM donations d2
          JOIN projects pr ON d2.project_id = pr.id
          WHERE d2.donor_address = p.public_key AND pr.verified = false
        )
        AND EXISTS (
          SELECT 1 FROM donations d3
          JOIN projects pr2 ON d3.project_id = pr2.id
          WHERE d3.donor_address = p.public_key AND pr2.verified = true
        )
      `;
    }

    query += `
      GROUP BY p.public_key, p.display_name, p.badges
      ORDER BY total_donated_xlm DESC
      LIMIT $1
    `;

    // eslint-disable-next-line sql-injection/no-sql-injection
    const result = await pool.query(query, [limit]);
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
