/**
 * src/routes/leaderboard.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

// 30 requests per minute per IP — prevents enumeration / data scraping (issue #695)
const leaderboardLimiter = createRateLimiter(30, 1);

// Cursor-based pagination constants (matching /api/projects conventions).
const LEADERBOARD_DEFAULT_LIMIT = 50;
const LEADERBOARD_MAX_LIMIT = 200;

router.get("/", leaderboardLimiter, async (req, res, next) => {
  try {
    const pageSize = Math.min(
      Number.parseInt(req.query.limit, 10) || LEADERBOARD_DEFAULT_LIMIT,
      LEADERBOARD_MAX_LIMIT
    );
    const cursor = req.query.cursor;
    const period = req.query.period || "all";
    const sortBy = req.query.sortBy === "impactScore" ? "impact_score" : "total_donated_xlm";
    const onlyVerified = req.query.onlyVerified === "true";

    const conditions = [];
    const params = [];

    if (period === "month") {
      conditions.push("d.created_at >= NOW() - INTERVAL '30 days'");
    } else if (period === "year") {
      conditions.push("d.created_at >= NOW() - INTERVAL '1 year'");
    }

    if (onlyVerified) {
      // Distinct aliases avoid clashing with the outer `pr` JOIN used for impact/CO2.
      const verifiedSubQuery = `
        NOT EXISTS (
          SELECT 1 FROM donations d2
          JOIN projects pr_unverified ON d2.project_id = pr_unverified.id
          WHERE d2.donor_address = p.public_key AND pr_unverified.verified = false
        )
        AND EXISTS (
          SELECT 1 FROM donations d3
          JOIN projects pr_verified ON d3.project_id = pr_verified.id
          WHERE d3.donor_address = p.public_key AND pr_verified.verified = true
        )
      `;
      conditions.push(`(${verifiedSubQuery})`);
    }

    // Cursor-based pagination on (sortBy, public_key), mirroring /api/projects.
    if (cursor) {
      let cursorData;
      try {
        cursorData = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      const sortValue = cursorData[sortBy];
      const publicKey = cursorData.publicKey;
      if (sortValue === undefined || !publicKey) {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      params.push(sortValue, publicKey);
      const sortIdx = params.length - 1;
      const keyIdx = params.length;
      conditions.push(
        `(${sortBy} < $${sortIdx} OR (${sortBy} = $${sortIdx} AND p.public_key < $${keyIdx}))`,
      );
    }

    // Fetch pageSize + 1 so we can detect whether another page exists.
    params.push(pageSize + 1);
    const limitIdx = params.length;

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join("\n  AND ")}`
      : "";

    const query = `
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
      LEFT JOIN projects pr ON pr.id = d.project_id
      ${whereClause}
      GROUP BY p.public_key, p.display_name, p.badges
      ORDER BY ${sortBy} DESC, p.public_key DESC
      LIMIT $${limitIdx}
    `;

    // eslint-disable-next-line sql-injection/no-sql-injection
    const result = await pool.query(query, params);
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);

    const entries = pageRows.map((p, i) => ({
      rank: i + 1,
      publicKey: p.public_key,
      displayName: p.display_name || null,
      totalDonatedXLM: p.total_donated_xlm?.toString() || "0",
      projectsSupported: p.projects_supported,
      topBadge: p.badges?.[0]?.tier || null,
      impactScore: p.impact_score?.toString() || "0",
      totalCO2OffsetKg: p.total_co2_offset_kg?.toString() || "0",
    }));

    let nextCursor = null;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ [sortBy]: last[sortBy], publicKey: last.public_key }),
      ).toString("base64");
    }

    res.json({
      success: true,
      data: entries,
      has_more: hasMore,
      next_cursor: nextCursor,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/leaderboard/history
 * Returns the monthly leaderboard snapshots, grouped by month descending.
 * Query params:
 *   - months (int, max 24, default 12): how many past months to return
 */
router.get("/history", leaderboardLimiter, async (req, res, next) => {
  try {
    const months = Math.min(parseInt(req.query.months, 10) || 12, 24);
    const result = await pool.query(
      `SELECT month, donor_address, display_name, total_xlm_that_month, badge, rank
       FROM monthly_leaderboard
       WHERE month >= DATE_TRUNC('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
       ORDER BY month DESC, rank ASC`,
      [months]
    );

    // Group rows by month
    const grouped = {};
    for (const row of result.rows) {
      const key = row.month.toISOString().slice(0, 7); // "YYYY-MM"
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        rank: row.rank,
        donorAddress: row.donor_address,
        displayName: row.display_name || null,
        totalXLMThatMonth: row.total_xlm_that_month?.toString() || "0",
        badge: row.badge || null,
      });
    }

    const history = Object.entries(grouped).map(([month, entries]) => ({ month, entries }));
    res.json({ success: true, data: history });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/leaderboard/snapshot
 * Admin endpoint: snapshot the current month's top donors into monthly_leaderboard.
 * Idempotent — re-running for the same month overwrites existing rows via ON CONFLICT.
 * Requires header: x-admin-secret matching ADMIN_SECRET env var.
 */
router.post("/snapshot", async (req, res, next) => {
  try {
    const secret = req.headers["x-admin-secret"];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    // Compute this calendar month's top donors
    const topResult = await pool.query(
      `SELECT p.public_key, p.display_name, p.badges,
              COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_xlm
       FROM profiles p
       LEFT JOIN donations d
         ON p.public_key = d.donor_address
        AND d.created_at >= DATE_TRUNC('month', NOW())
        AND d.created_at <  DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
       GROUP BY p.public_key, p.display_name, p.badges
       HAVING COALESCE(SUM(d.amount_xlm), 0) > 0
       ORDER BY total_xlm DESC
       LIMIT $1`,
      [limit]
    );

    if (topResult.rows.length === 0) {
      return res.json({ success: true, message: "No donations this month yet", inserted: 0 });
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStr = monthStart.toISOString().slice(0, 10); // "YYYY-MM-01"

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let inserted = 0;
      for (let i = 0; i < topResult.rows.length; i++) {
        const row = topResult.rows[i];
        const badge = row.badges?.[0]?.tier || null;
        await client.query(
          `INSERT INTO monthly_leaderboard
             (month, donor_address, display_name, total_xlm_that_month, badge, rank)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (month, donor_address)
           DO UPDATE SET
             display_name          = EXCLUDED.display_name,
             total_xlm_that_month  = EXCLUDED.total_xlm_that_month,
             badge                 = EXCLUDED.badge,
             rank                  = EXCLUDED.rank`,
          [monthStr, row.public_key, row.display_name || null, row.total_xlm, badge, i + 1]
        );
        inserted++;
      }
      await client.query("COMMIT");
      res.json({ success: true, month: monthStr, inserted });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

module.exports = router;