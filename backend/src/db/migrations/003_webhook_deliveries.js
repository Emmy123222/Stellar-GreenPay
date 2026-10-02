"use strict";

module.exports = {
  name: "003_webhook_deliveries",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'delivered', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at TIMESTAMPTZ,
        next_attempt_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
        ON webhook_deliveries (status)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project_id
        ON webhook_deliveries (project_id)
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS webhook_deliveries");
  },
};
