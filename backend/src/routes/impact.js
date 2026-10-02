"use strict";

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const pool = require("../db/pool");
const redis = require("../services/redis");
const { buildPdf } = require("../utils/pdf");

const CACHE_TTL_SECONDS = 5 * 60;
const KG_CO2_PER_TREE = 21.77; // heuristic, used for treesEquivalent

// Returned as `reason` when a project's CO₂ rate is missing or zero so
// callers can distinguish "not configured" from a genuine 0 kg offset.
const CO2_RATE_NOT_CONFIGURED = "co2_rate_not_configured";

function parseCo2Rate(value) {
  if (value === null || value === undefined) return 0;
  const rate = Number.parseFloat(value.toString());
  return Number.isFinite(rate) ? rate : 0;
}

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

async function sendCached(req, res, payload) {
  await redis.set(cacheKey(req), payload, CACHE_TTL_SECONDS);
  res.set("Cache-Control", "public, max-age=300");
  return res.json(payload);
}

function generateSlug() {
  return crypto.randomBytes(9).toString("base64url");
}

// GET /api/impact/project/:id
// (also aliased as GET /api/impact/:projectId — see below)
//
// CO₂ offset is computed as total_donated_xlm * project.co2_per_xlm.
// When the project's rate is missing or 0 (misconfigured), the CO₂ fields
// come back null with reason "co2_rate_not_configured" instead of a
// misleading 0 kg figure.
async function handleProjectImpact(req, res, projectId) {
  const hit = await redis.get(cacheKey(req));
  if (hit) return res.json(hit);

  const projectResult = await pool.query(
    `SELECT id, category, raised_xlm, co2_offset_kg, co2_per_xlm
       FROM projects
       WHERE id = $1`,
    [projectId],
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
    [projectId],
  );

  const p = projectResult.rows[0];
  const totalDonationsXLM = Number.parseFloat(aggResult.rows[0].totalDonationsXLM || "0");
  const donorCount = aggResult.rows[0].donorCount || 0;
  const uniqueCountries = aggResult.rows[0].uniqueCountries || 0;

  const co2Rate = parseCo2Rate(p.co2_per_xlm);
  const rateConfigured = co2Rate > 0;

  // Unconfigured rate → explicit null (never a silent 0 kg).
  let co2Kg = null;
  let co2OffsetKg = null;
  let reason = CO2_RATE_NOT_CONFIGURED;
  let treesEquivalent = 0;
  if (rateConfigured) {
    co2Kg = totalDonationsXLM * co2Rate;
    co2OffsetKg = Math.round(co2Kg);
    treesEquivalent = treesEquivalentFromKg(co2OffsetKg);
    reason = null;
  }

  return await sendCached(req, res, {
    success: true,
    data: {
      totalDonationsXLM: totalDonationsXLM.toFixed(7),
      donorCount,
      co2_kg: co2Kg,
      co2OffsetKg,
      treesEquivalent,
      uniqueCountries,
      reason,
      ...(rateConfigured ? { co2_per_xlm: p.co2_per_xlm.toString() } : {}),
    },
    // Top-level mirrors so clients expecting the bare
    // `{ co2_kg, reason }` shape work without unwrapping `data`.
    co2_kg: co2Kg,
    reason,
  });
}

router.get("/project/:id", async (req, res, next) => {
  try {
    return await handleProjectImpact(req, res, req.params.id);
  } catch (e) {
    next(e);
  }
});

// GET /api/impact/global
router.get("/global", async (req, res, next) => {
  try {
    const hit = await redis.get(cacheKey(req));
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

    const countryBreakdown = countryBreakdownResult.rows.map((row) => ({
      country: row.country,
      totalDonationsXLM: Number.parseFloat(row.totalDonationsXLM || "0").toFixed(7),
      donorCount: row.donorCount || 0,
    }));

    const breakdownByCategory = breakdownResult.rows.map((row) => ({
      category: row.category,
      totalDonationsXLM: Number.parseFloat(row.totalDonationsXLM || "0").toFixed(7),
      donorCount: row.donorCount || 0,
      co2OffsetKg: Math.round(Number.parseFloat(row.co2OffsetKg || "0")),
    }));

    return await sendCached(req, res, {
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

// GET /api/impact/donor/:publicKey
router.get("/donor/:publicKey", async (req, res, next) => {
  try {
    validateKey(req.params.publicKey);

    const hit = await redis.get(cacheKey(req));
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

    return await sendCached(req, res, {
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

// POST /api/impact/certificate
//
// Creates a shareable impact certificate record with a unique slug.
// The slug is used by GET /api/impact/certificate/:slug and by the public
// certificate page at /certificate/:slug.
router.post("/certificate", async (req, res, next) => {
  try {
    const {
      donorAddress,
      donorName,
      totalDonatedXLM,
      totalCO2OffsetKg,
      badgeTier,
      projectsSupported,
    } = req.body || {};

    if (!donorAddress || typeof donorAddress !== "string") {
      return res.status(400).json({ success: false, error: "donorAddress is required" });
    }

    const displayName = (donorName && String(donorName).trim()) || donorAddress;
    const projects = Array.isArray(projectsSupported) ? projectsSupported : [];
    const totalXlm = Number.parseFloat(totalDonatedXLM || "0");
    const co2Kg = Math.round(Number(totalCO2OffsetKg || 0));

    let slug = generateSlug();
    let inserted = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await pool.query(
          `INSERT INTO impact_certificates
             (slug, donor_address, donor_name, total_donated_xlm, co2_offset_kg, badge_tier, projects_supported)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           RETURNING slug, donor_address, donor_name, total_donated_xlm, co2_offset_kg, badge_tier, projects_supported, created_at`,
          [
            slug,
            donorAddress,
            displayName,
            Number.isFinite(totalXlm) ? totalXlm : 0,
            co2Kg,
            badgeTier || "Supporter",
            JSON.stringify(projects),
          ],
        );
        inserted = result.rows[0];
        break;
      } catch (err) {
        if (err && err.code === "23505") {
          slug = generateSlug();
          continue;
        }
        throw err;
      }
    }

    if (!inserted) {
      return res.status(500).json({ success: false, error: "Could not allocate certificate slug" });
    }

    const shareUrl = `${req.protocol}://${req.get("host")}/certificate/${inserted.slug}`;

    return res.status(201).json({
      success: true,
      data: {
        slug: inserted.slug,
        shareUrl,
        donorAddress: inserted.donor_address,
        donorName: inserted.donor_name,
        totalDonatedXLM: Number.parseFloat(inserted.total_donated_xlm?.toString() || "0").toFixed(7),
        co2OffsetKg: Number(inserted.co2_offset_kg || 0),
        badgeTier: inserted.badge_tier,
        projectsSupported: inserted.projects_supported || [],
        createdAt: inserted.created_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/impact/certificate/:slug
//
// Public JSON representation of a certificate, consumed by the
// /certificate/[slug] page for SSR and social previews.
router.get("/certificate/:slug", async (req, res, next) => {
  try {
    const { slug } = req.params;
    if (!slug || !/^[A-Za-z0-9_-]{6,64}$/.test(slug)) {
      return res.status(400).json({ success: false, error: "Invalid slug" });
    }

    const result = await pool.query(
      `SELECT slug, donor_address, donor_name, total_donated_xlm, co2_offset_kg, badge_tier, projects_supported, created_at
       FROM impact_certificates
       WHERE slug = $1`,
      [slug],
    );

    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, error: "Certificate not found" });

    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      success: true,
      data: {
        slug: row.slug,
        donorAddress: row.donor_address,
        donorName: row.donor_name,
        totalDonatedXLM: Number.parseFloat(row.total_donated_xlm?.toString() || "0").toFixed(7),
        co2OffsetKg: Number(row.co2_offset_kg || 0),
        badgeTier: row.badge_tier,
        projectsSupported: row.projects_supported || [],
        createdAt: row.created_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/impact/certificate/pdf
//
// Server-side impact certificate renderer. Used as the fallback for browsers
// whose client-side canvas rendering is unreliable (notably Safari), where the
// in-browser html2canvas/jsPDF path produces misaligned output.
router.post("/certificate/pdf", async (req, res, next) => {
  try {
    const {
      donorAddress,
      donorName,
      totalDonatedXLM,
      totalCO2OffsetKg,
      badgeTier,
      projectsSupported,
    } = req.body || {};

    if (!donorAddress || typeof donorAddress !== "string") {
      return res.status(400).json({ success: false, error: "donorAddress is required" });
    }

    const displayName = (donorName && String(donorName).trim()) || donorAddress;
    const projects = Array.isArray(projectsSupported) ? projectsSupported : [];

    const lines = [
      { text: "Stellar GreenPay", size: 12 },
      { text: "Impact Certificate", size: 26, gap: 10 },
      { text: "This certificate recognizes climate impact achieved", size: 12, gap: 8 },
      { text: "through on-chain donations.", size: 12 },
      { text: `Presented to: ${displayName}`, size: 16, gap: 18 },
      { text: `Donor address: ${donorAddress}`, size: 10 },
      {
        text: `Total donated: ${Number.parseFloat(totalDonatedXLM || "0").toFixed(7)} XLM`,
        size: 12,
        gap: 14,
      },
      { text: `CO2 offset: ${Math.round(Number(totalCO2OffsetKg || 0))} kg` },
      { text: `Badge tier: ${badgeTier || "Supporter"}` },
      { text: `Issued on: ${new Date().toISOString().slice(0, 10)}`, size: 10, gap: 14 },
      { text: `Projects supported (${projects.length}):`, size: 12, gap: 12 },
      ...projects.slice(0, 12).map((p) => ({ text: `- ${(p && p.name) || "Project"}`, size: 11 })),
      { text: "Verified by on-chain donation history", size: 10, gap: 18 },
    ];

    const pdf = buildPdf(lines);

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="greenpay-impact-${donorAddress.slice(0, 8)}.pdf"`);
    return res.send(pdf);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
