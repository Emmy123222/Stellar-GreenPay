/**
 * src/routes/stats.js
 * GET /api/stats/global    — landing-page aggregate platform totals.
 * GET /api/stats/categories — project count per category.
 * GET /api/stats/trends    — week-over-week donation growth rate.
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const redis = require("../services/redis");

const GLOBAL_STATS_CACHE_KEY = "stats:global";
const GLOBAL_STATS_CACHE_TTL_SECONDS = 60;

const TRENDS_CACHE_KEY = "stats:trends";
const TRENDS_CACHE_TTL_SECONDS = 300; // 5 minutes

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
      WITH project_totals AS (
        SELECT
          COALESCE(SUM(raised_xlm), 0)      AS total_xlm_raised,
          COALESCE(SUM(co2_offset_kg), 0)::int AS total_co2_offset_kg,
          COUNT(*)::int                    AS total_projects,
          COALESCE(SUM(donor_count), 0)::int AS total_donors
        FROM projects
      ),
      donation_totals AS (
        SELECT
          COUNT(*)::int AS total_donations
        FROM donations
      )
      SELECT
        p.total_xlm_raised     AS "totalXLMRaised",
        p.total_co2_offset_kg  AS "totalCO2OffsetKg",
        d.total_donations      AS "totalDonations",
        p.total_projects       AS "totalProjects",
        p.total_donors         AS "totalDonors"
      FROM project_totals p
      CROSS JOIN donation_totals d
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
        COUNT(*)::int AS count
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

/**
 * GET /api/stats/trends
 *
 * Returns week-over-week donation growth comparing the 7 days ending at
 * midnight UTC today ("this week") against the prior 7 days ("last week").
 *
 * Response shape:
 * {
 *   "thisWeekXLM":        "1250.0000000",
 *   "lastWeekXLM":        "980.0000000",
 *   "growthPercent":      27.55,           // null when lastWeek is 0
 *   "thisWeekDonations":  42,
 *   "lastWeekDonations":  35
 * }
 */
router.get("/trends", async (req, res, next) => {
  try {
    const cached = await redis.get(TRENDS_CACHE_KEY);
    if (cached) {
      return res.json(cached);
    }

    const result = await pool.query(`
      WITH bounds AS (
        SELECT
          date_trunc('day', NOW() AT TIME ZONE 'UTC')                    AS week_end,
          date_trunc('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'  AS week_start,
          date_trunc('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'  AS prev_end,
          date_trunc('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '14 days' AS prev_start
      ),
      this_week AS (
        SELECT
          COALESCE(SUM(COALESCE(amount_xlm, amount)), 0) AS total_xlm,
          COUNT(*)::int                                   AS total_count
        FROM donations, bounds
        WHERE created_at >= bounds.week_start
          AND created_at <  bounds.week_end
      ),
      last_week AS (
        SELECT
          COALESCE(SUM(COALESCE(amount_xlm, amount)), 0) AS total_xlm,
          COUNT(*)::int                                   AS total_count
        FROM donations, bounds
        WHERE created_at >= bounds.prev_start
          AND created_at <  bounds.prev_end
      )
      SELECT
        tw.total_xlm   AS "thisWeekXLM",
        lw.total_xlm   AS "lastWeekXLM",
        tw.total_count AS "thisWeekDonations",
        lw.total_count AS "lastWeekDonations"
      FROM this_week tw
      CROSS JOIN last_week lw
    `);

    const row = result.rows[0] || {};

    const thisWeekXLM = parseFloat(row.thisWeekXLM || "0");
    const lastWeekXLM = parseFloat(row.lastWeekXLM || "0");

    let growthPercent = null;
    if (lastWeekXLM > 0) {
      growthPercent = parseFloat(
        (((thisWeekXLM - lastWeekXLM) / lastWeekXLM) * 100).toFixed(2)
      );
    }

    const payload = {
      thisWeekXLM:       thisWeekXLM.toFixed(7),
      lastWeekXLM:       lastWeekXLM.toFixed(7),
      growthPercent,
      thisWeekDonations: Number.parseInt(row.thisWeekDonations, 10) || 0,
      lastWeekDonations: Number.parseInt(row.lastWeekDonations, 10) || 0,
    };

    await redis.set(TRENDS_CACHE_KEY, payload, TRENDS_CACHE_TTL_SECONDS);

    res.json(payload);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.GLOBAL_STATS_CACHE_KEY = GLOBAL_STATS_CACHE_KEY;
module.exports.GLOBAL_STATS_CACHE_TTL_SECONDS = GLOBAL_STATS_CACHE_TTL_SECONDS;
module.exports.TRENDS_CACHE_KEY = TRENDS_CACHE_KEY;
module.exports.TRENDS_CACHE_TTL_SECONDS = TRENDS_CACHE_TTL_SECONDS;
module.exports.mapGlobalStatsRow = mapGlobalStatsRow;
