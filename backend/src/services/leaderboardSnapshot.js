/**
 * src/services/leaderboardSnapshot.js
 *
 * Shared snapshot logic: queries top donors for a given month and upserts them
 * into the monthly_leaderboard table.  Used by both the POST /api/leaderboard/snapshot
 * route and the monthly digest queue.
 */
"use strict";

const pool = require("../db/pool");

/**
 * Snapshot the top donors for the month that contains `monthDate`.
 * @param {Date} monthDate - any date within the target month
 * @param {number} [limit=100] - max number of donors to snapshot (capped at 500)
 * @returns {Promise<{month: string, inserted: number}>}
 */
async function snapshotLeaderboard(monthDate, limit = 100) {
  limit = Math.min(limit, 500);

  const topResult = await pool.query(
    `SELECT p.public_key, p.display_name, p.badges,
            COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_xlm
     FROM profiles p
     LEFT JOIN donations d
       ON p.public_key = d.donor_address
      AND d.created_at >= DATE_TRUNC('month', $1::timestamptz)
      AND d.created_at <  DATE_TRUNC('month', $1::timestamptz) + INTERVAL '1 month'
     GROUP BY p.public_key, p.display_name, p.badges
     HAVING COALESCE(SUM(d.amount_xlm), 0) > 0
     ORDER BY total_xlm DESC
     LIMIT $2`,
    [monthDate, limit]
  );

  if (topResult.rows.length === 0) {
    return { month: null, inserted: 0 };
  }

  const monthStart = new Date(monthDate);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStr = monthStart.toISOString().slice(0, 10);

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