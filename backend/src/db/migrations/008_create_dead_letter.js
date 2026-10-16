"use strict";

module.exports = {
  name: "008_create_dead_letter",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS dead_letter (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        queue_name TEXT NOT NULL,
        job_id TEXT,
        payload JSONB,
        error TEXT,
        failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dead_letter_queue_name
      ON dead_letter (queue_name)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dead_letter_failed_at
      ON dead_letter (failed_at DESC)
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS dead_letter");
  },
};
