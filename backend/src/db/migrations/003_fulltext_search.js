"use strict";

module.exports = {
  name: "003_fulltext_search",

  async up(client) {
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS search_vector TSVECTOR");

    // 003_add_search_vector_gin_index may already have created search_vector
    // as a GENERATED ALWAYS AS ... STORED column (the newer design). Generated
    // columns cannot be updated directly, so only backfill when the column is
    // a plain (non-generated) column.
    const colResult = await client.query(
      `SELECT is_generated FROM information_schema.columns
       WHERE table_name = 'projects' AND column_name = 'search_vector'`
    );
    const isGenerated = colResult.rows[0]?.is_generated === "ALWAYS";

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
