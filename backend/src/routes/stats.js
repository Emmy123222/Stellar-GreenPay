/**
 * src/routes/stats.js
 * GET /api/stats/global — platform-wide totals (donations count, XLM raised, CO2 offset)
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");

// GET /api/stats/global
router.get("/global", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(d.id)::int            AS "totalDonations",
        COALESCE(SUM(d.amount), 0)  AS "totalXLMRaised",
        COALESCE(SUM(p.co2_offset_kg), 0)::int AS "totalCO2OffsetKg"
      FROM donations d
      JOIN projects p ON p.id = d.project_id
      WHERE d.currency = 'XLM' OR d.currency IS NULL
    `);

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        totalDonations:  row.totalDonations,
        totalXLMRaised:  parseFloat(row.totalXLMRaised).toFixed(7),
        totalCO2OffsetKg: row.totalCO2OffsetKg,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
