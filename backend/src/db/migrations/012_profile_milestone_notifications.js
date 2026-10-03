"use strict";

module.exports = {
  name: "012_profile_milestone_notifications",

  async up(client) {
    await client.query(`
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS milestone_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_milestone_notifications (
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        percentage INTEGER NOT NULL CHECK (percentage IN (25, 50, 75, 100)),
        total_raised_xlm NUMERIC(20, 7) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (project_id, percentage)
      )
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS project_milestone_notifications");
    await client.query(`
      ALTER TABLE profiles DROP COLUMN IF EXISTS milestone_notifications_enabled
    `);
  },
};
