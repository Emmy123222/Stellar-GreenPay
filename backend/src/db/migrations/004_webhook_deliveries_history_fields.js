"use strict";

module.exports = {
  name: "004_webhook_deliveries_history_fields",

  async up(client) {
    await client.query(`
      ALTER TABLE webhook_deliveries
        ADD COLUMN IF NOT EXISTS event TEXT,
        ADD COLUMN IF NOT EXISTS payload_hash TEXT,
        ADD COLUMN IF NOT EXISTS response_status INTEGER
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project_created
        ON webhook_deliveries (project_id, created_at DESC)
    `);
  },

  async down(client) {
    await client.query(`
      DROP INDEX IF EXISTS idx_webhook_deliveries_project_created
    `);
    await client.query(`
      ALTER TABLE webhook_deliveries
        DROP COLUMN IF EXISTS event,
        DROP COLUMN IF EXISTS payload_hash,
        DROP COLUMN IF EXISTS response_status
    `);
  },
};
