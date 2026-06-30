"use strict";

module.exports = {
  name: "002_webhooks",

  async up(client) {
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_url    TEXT");
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_secret TEXT");
  },

  async down(client) {
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS webhook_url");
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS webhook_secret");
  },
};
