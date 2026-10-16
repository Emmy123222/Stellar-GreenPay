"use strict";

module.exports = {
  name: "009_admin_audit_retention",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id UUID PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
      ON admin_audit_log (created_at)
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_admin_audit_log_created_at");
  },
};