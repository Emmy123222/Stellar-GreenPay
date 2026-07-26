/**
 * src/routes/impact.js
 * Impact aggregation endpoints with HTTP conditional caching (ETag & Last-Modified).
 *
 * - GET /api/impact/project/:id
 * - GET /api/impact/global
 * - GET /api/impact/donor/:publicKey
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const cache = require("../services/cache");
const { sendConditionalResponse, generateETag } = require("../utils/conditionalCache");

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

function sendCachedResponse(req, res, payload, lastModified) {
  const etag = generateETag(payload);
  cache.set(cacheKey(req), { payload, lastModified, etag }, CACHE_TTL_MS);
  return sendConditionalResponse(req, res, payload, lastModified, etag);
}

// GET /api/impact/project/:id
router.get("/project/:id", async (req, res, next) => {
  try {
    const hit = cache.get(cacheKey(req));
    if (hit) {
      return sendConditionalResponse(req, res, hit.payload, hit.lastModified, hit.etag);
    }

    const projectResult = await pool.query(
      `SELECT id, category, raised_xlm, co2_offset_kg, updated_at, created_at
       FROM projects
       WHERE id = $1`,
      [req.params.id],
    );
    if (!projectResult.rows[0]) return res.status(404).json({ error: "Project not found" });

    const aggResult = await pool.query(
      `SELECT
        COALESCE(SUM(d.amount_xlm), 0) AS "totalDonationsXLM",
        COUNT(DISTINCT d.donor_address)::int AS "donorCount",
        MAX(d.created_at) AS "latestDonationAt"
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

    const pDate = p.updated_at || p.created_at;
    const dDate = aggResult.rows[0].latestDonationAt;
    const dates = [pDate ? new Date(pDate) : null, dDate ? new Date(dDate) : null].filter(Boolean);
    const lastModified = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();

    const payload = {
      success: true,
      data: {
        totalDonationsXLM: totalDonationsXLM.toFixed(7),
        donorCount,
        co2OffsetKg,
        treesEquivalent: treesEquivalentFromKg(co2OffsetKg),
        uniqueCountries: 0,
      },
    };

    return sendCachedResponse(req, res, payload, lastModified);
  } catch (e) {
    next(e);
  }
});

// GET /api/impact/global
router.get("/global", async (req, res, next) => {
  try {
    const hit = cache.get(cacheKey(req));
    if (hit) {
      return sendConditionalResponse(req, res, hit.payload, hit.lastModified, hit.etag);
    }

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

    const timestampsResult = await pool.query(
      `SELECT
        (SELECT MAX(updated_at) FROM projects) AS "maxProjectUpdated",
        (SELECT MAX(created_at) FROM donations WHERE currency = 'XLM' OR currency IS NULL) AS "maxDonationCreated"`,
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

    const maxProj = timestampsResult.rows[0]?.maxProjectUpdated;
    const maxDon = timestampsResult.rows[0]?.maxDonationCreated;
    const dates = [maxProj ? new Date(maxProj) : null, maxDon ? new Date(maxDon) : null].filter(Boolean);
    const lastModified = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();

    const payload = {
      success: true,
      data: {
        totalDonationsXLM: totalDonationsXLM.toFixed(7),
        donorCount,
        co2OffsetKg,
        treesEquivalent: treesEquivalentFromKg(co2OffsetKg),
        uniqueCountries: 0,
        breakdownByCategory,
      },
    };

    return sendCachedResponse(req, res, payload, lastModified);
  } catch (e) {
    next(e);
  }
});

// GET /api/impact/donor/:publicKey
router.get("/donor/:publicKey", async (req, res, next) => {
  try {
    validateKey(req.params.publicKey);

    const hit = cache.get(cacheKey(req));
    if (hit) {
      return sendConditionalResponse(req, res, hit.payload, hit.lastModified, hit.etag);
    }

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

    const timestampsResult = await pool.query(
      `SELECT
        MAX(d.created_at) AS "maxDonationCreated",
        MAX(p.updated_at) AS "maxProjectUpdated"
       FROM donations d
       JOIN projects p ON p.id = d.project_id
       WHERE d.donor_address = $1
         AND (d.currency = 'XLM' OR d.currency IS NULL)`,
      [req.params.publicKey],
    );

    const row = totalsResult.rows[0] || {};
    const totalDonatedXLM = Number.parseFloat(row.totalDonatedXLM || "0");
    const projectsSupported = row.projectsSupported || 0;
    const co2OffsetKg = Math.round(Number.parseFloat(row.co2OffsetKg || "0"));
    const topCategory = topCategoryResult.rows[0]?.category || null;

    const maxDon = timestampsResult.rows[0]?.maxDonationCreated;
    const maxProj = timestampsResult.rows[0]?.maxProjectUpdated;
    const dates = [maxDon ? new Date(maxDon) : null, maxProj ? new Date(maxProj) : null].filter(Boolean);
    const lastModified = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();

    const payload = {
      success: true,
      data: {
        totalDonatedXLM: totalDonatedXLM.toFixed(7),
        co2OffsetKg,
        projectsSupported,
        topCategory,
      },
    };

    return sendCachedResponse(req, res, payload, lastModified);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
