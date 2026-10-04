"use strict";

// Supports the batched cleanup query in tokenCleanupQueue.js:
//   SELECT id FROM device_tokens
//   WHERE last_delivered_at IS NOT NULL
//     AND last_delivered_at < NOW() - INTERVAL '90 days'
//   LIMIT 1000
//
// Without this index, each batch does a sequential scan on the whole table.
// The partial index covers only the rows eligible for cleanup, keeping it small.
module.exports = {
  name: "008_device_token_last_delivered_index",

  async up(client) {
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_tokens_stale_cleanup
      ON device_tokens (last_delivered_at)
      WHERE last_delivered_at IS NOT NULL
    `);
  },

  async down(client) {
    await client.query(`
      DROP INDEX CONCURRENTLY IF EXISTS idx_device_tokens_stale_cleanup
    `);
  },
};
