"use strict";

module.exports = {
  name: "003_global_stats_mv",

  async up(client) {
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS global_stats_mv AS
      SELECT
        1 AS id,
        COALESCE(SUM(raised_xlm), 0) AS total_xlm_raised,
        COALESCE(SUM(co2_offset_kg), 0)::int AS total_co2_offset_kg,
        COUNT(*)::int AS total_projects,
        COALESCE(SUM(donor_count), 0)::int AS total_donors,
        (SELECT COUNT(*)::int FROM donations) AS total_donations
      FROM projects
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS global_stats_mv_id_uidx
      ON global_stats_mv (id)
    `);
  },

  async down(client) {
    await client.query(`DROP INDEX IF EXISTS global_stats_mv_id_uidx`);
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS global_stats_mv`);
  },
};
