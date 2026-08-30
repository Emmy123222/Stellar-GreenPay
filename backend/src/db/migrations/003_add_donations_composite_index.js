"use strict";

module.exports = {
  name: "003_add_donations_composite_index",

  // CONCURRENTLY can't run inside a transaction block, and every migration
  // here runs inside the shared transaction opened by runMigrations().
  async up(client) {
    await client.query("CREATE INDEX idx_donations_donor_project ON donations(donor_address, project_id)");
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_donations_donor_project");
  }
};
