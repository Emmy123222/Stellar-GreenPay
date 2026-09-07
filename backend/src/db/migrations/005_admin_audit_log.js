"use strict";

const migration = {
  name: "Add admin_audit_log table with retention policy support",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id UUID PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}',
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Indexes for query performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
        ON admin_audit_log (created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
        ON admin_audit_log (actor, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
        ON admin_audit_log (action, created_at DESC)
    `);

    // Composite index for archival queries (age filtering)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_retention
        ON admin_audit_log (created_at)
        WHERE created_at IS NOT NULL
    `);
  },

  async down(client) {
    await client.query(`DROP TABLE IF EXISTS admin_audit_log CASCADE`);
  },
};

module.exports = migration;
