"use strict";

module.exports = {
  name: "003_add_donations_composite_index",

  async up(client) {
    await client.query("CREATE INDEX CONCURRENTLY idx_donations_donor_project ON donations(donor_address, project_id)");
  },

  async down(client) {
    await client.query("DROP INDEX CONCURRENTLY IF EXISTS idx_donations_donor_project");
  }
};
