"use strict";

/**
 * Allow wallet-address follows alongside device-token (push) follows on
 * project_follows. Web Follow buttons use (project_id, wallet_address) with
 * device_token_id NULL; mobile push continues to use device_token_id.
 */
module.exports = {
  name: "003_wallet_project_follows",

  async up(client) {
    await client.query(`
      ALTER TABLE project_follows
        ALTER COLUMN device_token_id DROP NOT NULL
    `);

    // One wallet-only follow row per (project, wallet). Device-token rows may
    // also store wallet_address for push targeting and are excluded here.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS project_follows_project_wallet_uidx
        ON project_follows (project_id, wallet_address)
        WHERE device_token_id IS NULL AND wallet_address IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS project_follows_wallet_lookup_idx
        ON project_follows (project_id, wallet_address)
        WHERE wallet_address IS NOT NULL
    `);
  },

  async down(client) {
    await client.query(
      "DROP INDEX IF EXISTS project_follows_wallet_lookup_idx",
    );
    await client.query(
      "DROP INDEX IF EXISTS project_follows_project_wallet_uidx",
    );

    // Remove wallet-only rows before restoring NOT NULL on device_token_id.
    await client.query(
      "DELETE FROM project_follows WHERE device_token_id IS NULL",
    );
    await client.query(`
      ALTER TABLE project_follows
        ALTER COLUMN device_token_id SET NOT NULL
    `);
  },
};
