"use strict";

module.exports = {
  name: "003_webhook_secret_rotation",

  async up(client) {
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS previous_webhook_secret TEXT");
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_secret_rotated_at TIMESTAMPTZ");
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS previous_webhook_secret_expires_at TIMESTAMPTZ");
  },

  async down(client) {
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS previous_webhook_secret");
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS webhook_secret_rotated_at");
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS previous_webhook_secret_expires_at");
  },
};
