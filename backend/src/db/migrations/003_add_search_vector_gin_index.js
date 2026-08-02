"use strict";

module.exports = {
  name: "003_add_search_vector_gin_index",

  async up(client) {
    await client.query(`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
          to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, ''))
        ) STORED
    `);
    await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_search_vector ON projects USING GIN(search_vector)`);
  },

  async down(client) {
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_projects_search_vector`);
  }
};
