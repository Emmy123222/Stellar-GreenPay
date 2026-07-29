"use strict";

module.exports = {
  name: "003_monthly_leaderboard",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_leaderboard (
        month DATE NOT NULL,
        donor_address TEXT NOT NULL,
        display_name TEXT,
        total_xlm_that_month NUMERIC(20, 7) NOT NULL,
        badge TEXT,
        rank INTEGER NOT NULL,
        PRIMARY KEY (month, donor_address)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS monthly_leaderboard_month_idx 
      ON monthly_leaderboard (month DESC)
    `);
  },

  async down(client) {
    await client.query(`DROP INDEX IF EXISTS monthly_leaderboard_month_idx`);
    await client.query(`DROP TABLE IF EXISTS monthly_leaderboard`);
  },
};
