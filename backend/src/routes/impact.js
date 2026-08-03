"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const redis = require("../services/redis");

/**
 * GET /api/impact/project/:id/timeline
 * Time-series view of a project's impact
 */
router.get("/project/:id/timeline", async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const cacheKey = "impact:timeline:" + projectId;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const result = await pool.query(
      `SELECT 
         TO_CHAR(d.created_at, 'YYYY-MM-DD') AS date,
         SUM(CASE WHEN d.currency = 'XLM' THEN d.amount_xlm ELSE 0 END) AS daily_xlm,
         SUM(CASE WHEN d.currency = 'XLM' THEN d.amount_xlm * p.co2_offset_kg ELSE 0 END) AS daily_co2_kg
       FROM donations d
       JOIN projects p ON d.project_id = p.id
       WHERE d.project_id = $1
       GROUP BY TO_CHAR(d.created_at, 'YYYY-MM-DD')
       ORDER BY date ASC`,
      [projectId]
    );

    const data = result.rows.map(row => ({
      date: row.date,
      dailyXLM: Number.parseFloat(row.daily_xlm || 0).toFixed(1),
      dailyCO2Kg: Math.round(Number.parseFloat(row.daily_co2_kg || 0))
    }));

    const responseBody = { data };
    // Cache in Redis for 10 minutes (600 seconds)
    await redis.set(cacheKey, responseBody, 600);
    
    res.json(responseBody);
  } catch (e) {
    next(e);
  }
});

/**
 * Invalidate the cached impact summary for a project, e.g. after a new
 * donation is recorded for it.
 *
 * @param {string} projectId - The project whose cached impact data is stale.
 * @returns {Promise<void>}
 */
async function invalidateProjectImpactCache(projectId) {
  await redis.deletePattern(projectImpactCacheKey(projectId));
}

module.exports = router;
