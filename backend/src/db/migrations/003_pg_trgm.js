"use strict";

module.exports = {
  name: "003_pg_trgm",

  async up(client) {
    // Enable pg_trgm extension for fuzzy text similarity (used by /api/projects/:id/similar)
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

    // Add a GIN trigram index on project names to speed up SIMILARITY() queries.
    // Uses CONCURRENTLY to avoid locking the table during creation.
    await client.query(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_name_trgm ON projects USING gin (name gin_trgm_ops)"
    );
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_projects_name_trgm");
    // We deliberately do NOT drop pg_trgm — other features could depend on it.
  },
};
