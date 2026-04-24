/**
 * src/routes/impact.js
 * Impact aggregation endpoints.
 *
 * - GET /api/impact/project/:id
 * - GET /api/impact/global
 * - GET /api/impact/donor/:publicKey
 *
 * All endpoints are cached for 5 minutes (process-local).
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const cache = require("../services/cache");

const CACHE_TTL_MS = 5 * 60 * 1000;
const KG_CO2_PER_TREE = 21.77; // heuristic, used for treesEquivalent

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function treesEquivalentFromKg(kg) {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return Number((kg / KG_CO2_PER_TREE).toFixed(2));
}

function cacheKey(req) {
  return req.originalUrl;
}

function sendCached(req, res, payload) {
  cache.set(cacheKey(req), payload, CACHE_TTL_MS);
  res.set("Cache-Control", "public, max-age=300");
  return res.json(payload);
}

// GET /api/impact/project/:id
router.get("/project/:id", async (req, res, next) => {
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
        COUNT(DISTINCT d.donor_address)::int AS "donorCount"
       FROM donations d
       WHERE d.project_id = $1
         AND (d.currency = 'XLM' OR d.currency IS NULL)`,
      [req.params.id],
    );

    const p = projectResult.rows[0];
    const totalDonationsXLM = Number.parseFloat(aggResult.rows[0].totalDonationsXLM || "0");
    const donorCount = aggResult.rows[0].donorCount || 0;

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
        uniqueCountries: 0,
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

    const breakdownByCategory = breakdownResult.rows.map((row) => ({
      category: row.category,
      totalDonationsXLM: Number.parseFloat(row.totalDonationsXLM || "0").toFixed(7),
      donorCount: row.donorCount || 0,
      co2OffsetKg: Math.round(Number.parseFloat(row.co2OffsetKg || "0")),
    }));

    return sendCached(req, res, {
      success: true,
      data: {
        totalDonationsXLM: totalDonationsXLM.toFixed(7),
        donorCount,
        co2OffsetKg,
        treesEquivalent: treesEquivalentFromKg(co2OffsetKg),
        uniqueCountries: 0,
        breakdownByCategory,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/impact/donor/:publicKey
router.get("/donor/:publicKey", async (req, res, next) => {
  try {
    validateKey(req.params.publicKey);

    const hit = cache.get(cacheKey(req));
    if (hit) return res.json(hit);

    const totalsResult = await pool.query(
      `SELECT
        COALESCE(SUM(d.amount_xlm), 0) AS "totalDonatedXLM",
        COUNT(DISTINCT d.project_id)::int AS "projectsSupported",
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
       WHERE d.donor_address = $1
         AND (d.currency = 'XLM' OR d.currency IS NULL)`,
      [req.params.publicKey],
    );

    const topCategoryResult = await pool.query(
      `SELECT
        p.category AS category,
        COALESCE(SUM(d.amount_xlm), 0) AS total
       FROM donations d
       JOIN projects p ON p.id = d.project_id
       WHERE d.donor_address = $1
         AND (d.currency = 'XLM' OR d.currency IS NULL)
       GROUP BY p.category
       ORDER BY total DESC
       LIMIT 1`,
      [req.params.publicKey],
    );

    const row = totalsResult.rows[0] || {};
    const totalDonatedXLM = Number.parseFloat(row.totalDonatedXLM || "0");
    const projectsSupported = row.projectsSupported || 0;
    const co2OffsetKg = Math.round(Number.parseFloat(row.co2OffsetKg || "0"));
    const topCategory = topCategoryResult.rows[0]?.category || null;

    return sendCached(req, res, {
      success: true,
      data: {
        totalDonatedXLM: totalDonatedXLM.toFixed(7),
        co2OffsetKg,
        projectsSupported,
        topCategory,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

