"use strict";

module.exports = {
  name: "005_device_token_cleanup",

  async up(client) {
    await client.query(`
      ALTER TABLE device_tokens
      ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_device_tokens_last_delivered
      ON device_tokens (last_delivered_at)
      WHERE last_delivered_at IS NULL
    `);
  },

  async down(client) {
    await client.query(`
      DROP INDEX IF EXISTS idx_device_tokens_last_delivered
    `);

    await client.query(`
      ALTER TABLE device_tokens
      DROP COLUMN IF EXISTS last_delivered_at
    `);
  },
};
