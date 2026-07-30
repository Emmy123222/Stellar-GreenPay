"use strict";

module.exports = {
  name: "003_csv_import_and_similar",

  async up(client) {
    // Add co2_per_xlm column for CSV import and CO₂-per-XLM tracking
    await client.query(
      "ALTER TABLE projects ADD COLUMN IF NOT EXISTS co2_per_xlm NUMERIC(20, 7)"
    );

    // Enable pg_trgm extension for fuzzy text similarity (used by /similar endpoint)
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

    // Add a GIN trigram index on project names to speed up SIMILARITY() queries.
    // Uses CONCURRENTLY to avoid locking the table during creation.
    await client.query(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_name_trgm ON projects USING gin (name gin_trgm_ops)"
    );
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_projects_name_trgm");
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS co2_per_xlm");
    // We deliberately do NOT drop pg_trgm — other features could depend on it.
  },
};
