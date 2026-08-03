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
    const hit = cache.get(cacheKey(req));
    if (hit) return res.json(hit);

    const projectResult = await pool.query(
      `SELECT id, category, raised_xlm, co2_offset_kg
       FROM projects
       WHERE id = $1`,
      [req.params.id],
    );
    if (!projectResult.rows[0]) return res.status(404).json({ error: "Project not found" });

    const aggResult = await pool.query(
      `SELECT
        COALESCE(SUM(d.amount_xlm), 0) AS "totalDonationsXLM",
        COUNT(DISTINCT d.donor_address)::int AS "donorCount",
        COUNT(DISTINCT d.donor_country)::int AS "uniqueCountries"
       FROM donations d
       JOIN projects p ON d.project_id = p.id
       WHERE d.project_id = $1
         AND (d.currency = 'XLM' OR d.currency IS NULL)`,
      [req.params.id],
    );

    const p = projectResult.rows[0];
    const totalDonationsXLM = Number.parseFloat(aggResult.rows[0].totalDonationsXLM || "0");
    const donorCount = aggResult.rows[0].donorCount || 0;
    const uniqueCountries = aggResult.rows[0].uniqueCountries || 0;

    const raisedXlm = Number.parseFloat(p.raised_xlm?.toString() || "0");
    const projectCo2OffsetKg = Number.parseFloat(p.co2_offset_kg?.toString() || "0");
    const kgPerXlm = raisedXlm > 0 ? projectCo2OffsetKg / raisedXlm : 0;
    const co2OffsetKg = Math.round(totalDonationsXLM * kgPerXlm);

    return sendCached(req, res, {
      success: true,
      data: {
        totalDonationsXLM: totalDonationsXLM.toFixed(7),
        donorCount,
        co2OffsetKg,
        treesEquivalent: treesEquivalentFromKg(co2OffsetKg),
        uniqueCountries,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/impact/global
router.get("/global", async (req, res, next) => {
  try {
    const hit = cache.get(cacheKey(req));
    if (hit) return res.json(hit);

    const totalsResult = await pool.query(
      `SELECT
        COALESCE(SUM(d.amount_xlm), 0) AS "totalDonationsXLM",
        COUNT(DISTINCT d.donor_address)::int AS "donorCount",
        COUNT(DISTINCT d.donor_country)::int AS "uniqueCountries",
        COALESCE(
          SUM(
            CASE
              WHEN p.raised_xlm > 0 THEN (d.amount_xlm * (p.co2_offset_kg::numeric / p.raised_xlm))
              ELSE 0
            END
          ),
          0
        ) AS "co2OffsetKg"
       FROM donations d
       JOIN projects p ON p.id = d.project_id
       WHERE (d.currency = 'XLM' OR d.currency IS NULL)`,
    );

    const breakdownResult = await pool.query(
      `SELECT
        p.category AS category,
        COALESCE(SUM(d.amount_xlm), 0) AS "totalDonationsXLM",
        COUNT(DISTINCT d.donor_address)::int AS "donorCount",
        COALESCE(
          SUM(
            CASE
              WHEN p.raised_xlm > 0 THEN (d.amount_xlm * (p.co2_offset_kg::numeric / p.raised_xlm))
              ELSE 0
            END
          ),
          0
        ) AS "co2OffsetKg"
       FROM donations d
       JOIN projects p ON p.id = d.project_id
       WHERE (d.currency = 'XLM' OR d.currency IS NULL)
       GROUP BY p.category
       ORDER BY "totalDonationsXLM" DESC, p.category ASC`,
    );

    const totalsRow = totalsResult.rows[0] || {};
    const totalDonationsXLM = Number.parseFloat(totalsRow.totalDonationsXLM || "0");
    const donorCount = totalsRow.donorCount || 0;
    const co2OffsetKg = Math.round(Number.parseFloat(totalsRow.co2OffsetKg || "0"));

    const countryBreakdownResult = await pool.query(
      `SELECT
        d.donor_country AS country,
        COALESCE(SUM(d.amount_xlm), 0) AS "totalDonationsXLM",
        COUNT(DISTINCT d.donor_address)::int AS "donorCount"
       FROM donations d
       JOIN projects p ON p.id = d.project_id
       WHERE (d.currency = 'XLM' OR d.currency IS NULL)
         AND d.donor_country IS NOT NULL
       GROUP BY d.donor_country
       ORDER BY "totalDonationsXLM" DESC
       LIMIT 20`,
    );

    const breakdownByCategory = breakdownResult.rows.map((row) => ({
      category: row.category,
      totalDonationsXLM: Number.parseFloat(row.totalDonationsXLM || "0").toFixed(7),
      donorCount: row.donorCount || 0,
      co2OffsetKg: Math.round(Number.parseFloat(row.co2OffsetKg || "0")),
    }));

    const countryBreakdown = countryBreakdownResult.rows.map((row) => ({
      country: row.country,
      totalDonationsXLM: Number.parseFloat(row.totalDonationsXLM || "0").toFixed(7),
      donorCount: row.donorCount || 0,
    }));

    return sendCached(req, res, {
      success: true,
      data: {
        totalDonationsXLM: totalDonationsXLM.toFixed(7),
        donorCount,
        co2OffsetKg,
        treesEquivalent: treesEquivalentFromKg(co2OffsetKg),
        uniqueCountries: totalsRow.uniqueCountries || 0,
        breakdownByCategory,
        countryBreakdown,
      },
    });
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
