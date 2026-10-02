"use strict";

module.exports = {
  name: "006_monthly_leaderboard_history_index",

  async up(client) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_monthly_leaderboard_month_rank
        ON monthly_leaderboard (month DESC, rank ASC)
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_monthly_leaderboard_month_rank");
  },
};