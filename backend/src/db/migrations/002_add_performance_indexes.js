"use strict";

module.exports = {
  name: "002_add_performance_indexes",

  async up(client) {
    await client.query(`CREATE INDEX CONCURRENTLY idx_donations_project_created ON donations(project_id, created_at DESC)`);
    await client.query(`CREATE INDEX CONCURRENTLY idx_profiles_donated ON profiles(total_donated_xlm DESC)`);
    await client.query(`CREATE INDEX CONCURRENTLY idx_projects_status_donor ON projects(status, donor_count DESC)`);
  },

  async down(client) {
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_projects_status_donor`);
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_profiles_donated`);
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_donations_project_created`);
  }
};
