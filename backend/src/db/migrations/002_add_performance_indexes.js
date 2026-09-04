"use strict";

module.exports = {
  name: "002_add_performance_indexes",
  autocommit: true,

  // CONCURRENTLY can't run inside a transaction block, and every migration
  // here runs inside the shared transaction opened by runMigrations().
  async up(client) {
    await client.query("CREATE INDEX idx_donations_project_created ON donations(project_id, created_at DESC)");
    await client.query("CREATE INDEX idx_profiles_donated ON profiles(total_donated_xlm DESC)");
    await client.query("CREATE INDEX idx_projects_status_donor ON projects(status, donor_count DESC)");
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_projects_status_donor");
    await client.query("DROP INDEX IF EXISTS idx_profiles_donated");
    await client.query("DROP INDEX IF EXISTS idx_donations_project_created");
  }
};
