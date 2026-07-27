"use strict";

module.exports = {
  name: "003_recurring_donations",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_donations (
        id TEXT PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        donor_address TEXT NOT NULL,
        amount_xlm NUMERIC(20, 7) NOT NULL,
        duration_months INTEGER,
        remaining_months INTEGER,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'cancelled', 'completed')),
        start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        next_due_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS recurring_donations_donor_idx
        ON recurring_donations (donor_address, status)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS recurring_donations_project_idx
        ON recurring_donations (project_id)
    `);
  },

  async down(client) {
    await client.query(`DROP INDEX IF EXISTS recurring_donations_project_idx`);
    await client.query(`DROP INDEX IF EXISTS recurring_donations_donor_idx`);
    await client.query(`DROP TABLE IF EXISTS recurring_donations`);
  },
};