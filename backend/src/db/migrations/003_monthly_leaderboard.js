/**
 * 003_monthly_leaderboard.js — Monthly leaderboard snapshots table
 *
 * Stores monthly snapshots of top donors used by GET /api/leaderboard/history
 * and populated by the admin-only POST /api/leaderboard/snapshot endpoint.
 *
 * The UNIQUE(month, donor_address) constraint is the foundation of the
 * idempotent upsert pattern: calling the snapshot endpoint multiple times
 * for the same calendar month does not create duplicate rows.
 */
"use strict";

module.exports = {
  name: "003_monthly_leaderboard",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_leaderboard (
        month                 DATE        NOT NULL,
        donor_address         TEXT        NOT NULL,
        display_name          TEXT,
        total_xlm_that_month  NUMERIC(20, 7) NOT NULL DEFAULT 0,
        badge                 TEXT,
        rank                  INTEGER     NOT NULL,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ,
        UNIQUE (month, donor_address)
      )
    `);

    // Index for the GET /history endpoint: latest months first, ordered by rank.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_monthly_leaderboard_month_rank
        ON monthly_leaderboard (month DESC, rank ASC)
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_monthly_leaderboard_month_rank");
    await client.query("DROP TABLE IF EXISTS monthly_leaderboard");
  },
};
