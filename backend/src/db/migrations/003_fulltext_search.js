"use strict";

module.exports = {
  name: "003_fulltext_search",

  async up(client) {
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS search_vector TSVECTOR");

    // If search_vector was already created as a GENERATED ALWAYS column (e.g. by
    // 003_add_search_vector_gin_index.js), updating it will throw Postgres error 428C9.
    const check = await client.query(`
      SELECT attgenerated
      FROM pg_attribute
      WHERE attrelid = 'projects'::regclass AND attname = 'search_vector'
    `);
    const isGenerated = check.rows.length > 0 && check.rows[0].attgenerated !== "";

    if (!isGenerated) {
      await client.query(`
        UPDATE projects
        SET search_vector = to_tsvector('english',
          COALESCE(name, '') || ' ' ||
          COALESCE(description, '') || ' ' ||
          COALESCE(location, '') || ' ' ||
          COALESCE(array_to_string(tags, ' '), '')
        )
        WHERE search_vector IS NULL
      `);
    }

    await client.query("CREATE INDEX IF NOT EXISTS idx_projects_search_vector ON projects USING GIN(search_vector)");
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_projects_search_vector");
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS search_vector");
  },
};
