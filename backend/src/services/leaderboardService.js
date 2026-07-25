/**
 * src/services/leaderboardService.js
 *
 * Shared logic for snapshotting the current month's top donors into the
 * `monthly_leaderboard` table. Used by both the POST /api/leaderboard/snapshot
 * admin route and the automated monthly digest job (digestQueue.js), so the
 * snapshot logic lives in a single place instead of being duplicated.
 */
"use strict";

const pool = require("../db/pool");

/**
 * Compute this calendar month's top donors and upsert them into
 * `monthly_leaderboard`. Idempotent — re-running for the same month
 * overwrites existing rows via ON CONFLICT.
 *
 * @param {Object} [options]
 * @param {number} [options.limit=100] Max number of donors to snapshot (capped at 500).
 * @returns {Promise<{ month: string|null, inserted: number, message?: string }>}
 */
async function snapshotLeaderboard({ limit = 100 } = {}) {
  const cappedLimit = Math.min(parseInt(limit, 10) || 100, 500);

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
    [cappedLimit]
  );

  if (topResult.rows.length === 0) {
    return { month: null, inserted: 0, message: "No donations this month yet" };
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
    return { month: monthStr, inserted };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { snapshotLeaderboard };
