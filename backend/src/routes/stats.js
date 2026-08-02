/**
 * src/routes/stats.js
 * GET /api/stats/global — landing-page aggregate platform totals.
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const redis = require("../services/redis");

const GLOBAL_STATS_CACHE_KEY = "stats:global";
const GLOBAL_STATS_CACHE_TTL_SECONDS = 60;

function mapGlobalStatsRow(row = {}) {
  return {
    totalXLMRaised: Number.parseFloat(row.totalXLMRaised || "0").toFixed(7),
    totalCO2OffsetKg: Number.parseInt(row.totalCO2OffsetKg, 10) || 0,
    totalDonations: Number.parseInt(row.totalDonations, 10) || 0,
    totalProjects: Number.parseInt(row.totalProjects, 10) || 0,
    totalDonors: Number.parseInt(row.totalDonors, 10) || 0,
  };
}

// GET /api/stats/global
router.get("/global", async (req, res, next) => {
  try {
    const cached = await redis.get(GLOBAL_STATS_CACHE_KEY);
    if (cached) {
      return res.json(cached);
    }

    const result = await pool.query(`
      SELECT
        total_xlm_raised     AS "totalXLMRaised",
        total_co2_offset_kg  AS "totalCO2OffsetKg",
        total_donations      AS "totalDonations",
        total_projects       AS "totalProjects",
        total_donors         AS "totalDonors"
      FROM global_stats_mv
      LIMIT 1
    `);

    const stats = mapGlobalStatsRow(result.rows[0]);
    await redis.set(GLOBAL_STATS_CACHE_KEY, stats, GLOBAL_STATS_CACHE_TTL_SECONDS);

    res.json(stats);
  } catch (e) {
    next(e);
  }
});

// GET /api/stats/categories — project count per category
router.get("/categories", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        category,
        COUNT(*)::int AS count,
        COALESCE(SUM(raised_xlm), 0) AS total_xlm,
        COALESCE(SUM(donor_count), 0)::int AS total_donations
      FROM projects
      WHERE status = 'active'
      GROUP BY category
      ORDER BY count DESC, category ASC
    `);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.GLOBAL_STATS_CACHE_KEY = GLOBAL_STATS_CACHE_KEY;
module.exports.GLOBAL_STATS_CACHE_TTL_SECONDS = GLOBAL_STATS_CACHE_TTL_SECONDS;
module.exports.mapGlobalStatsRow = mapGlobalStatsRow;
