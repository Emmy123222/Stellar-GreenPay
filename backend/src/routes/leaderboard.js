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
    const sortBy = req.query.sortBy === "impactScore" ? "impact_score" : "total_donated_xlm";

    let query = `
      SELECT p.public_key, p.display_name, p.badges,
             COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_donated_xlm,
             COUNT(DISTINCT d.project_id)::INTEGER AS projects_supported,
             COALESCE(
               SUM(
                 CASE
                   WHEN pr.raised_xlm > 0 THEN (d.amount_xlm * (pr.co2_offset_kg::numeric / pr.raised_xlm))
                   ELSE 0
                 END
               ),
               0
             )::NUMERIC AS total_co2_offset_kg,
             (
               COALESCE(SUM(d.amount_xlm), 0) * 0.7 +
               (
                 COALESCE(
                   SUM(
                     CASE
                       WHEN pr.raised_xlm > 0 THEN (d.amount_xlm * (pr.co2_offset_kg::numeric / pr.raised_xlm))
                       ELSE 0
                     END
                   ),
                   0
                 ) / 100
               ) * 0.3
             )::NUMERIC AS impact_score
      FROM profiles p
      LEFT JOIN donations d ON p.public_key = d.donor_address
    `;

    if (period === "month") {
      query += " AND d.created_at >= NOW() - INTERVAL '30 days' ";
    } else if (period === "year") {
      query += " AND d.created_at >= NOW() - INTERVAL '1 year' ";
    }

    query += `
      LEFT JOIN projects pr ON pr.id = d.project_id
      GROUP BY p.public_key, p.display_name, p.badges
      ORDER BY ${sortBy} DESC
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
      impactScore: p.impact_score?.toString() || "0",
      totalCO2OffsetKg: p.total_co2_offset_kg?.toString() || "0",
    }));
    res.json({ success: true, data: entries });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
