"use strict";

module.exports = {
  name: "003_recurring_donations",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_donations (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        wallet_address TEXT NOT NULL,
        amount_xlm NUMERIC(20, 7) NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'monthly',
        status TEXT NOT NULL DEFAULT 'active',
        start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        next_due_date TIMESTAMPTZ NOT NULL,
        last_executed_at TIMESTAMPTZ,
        duration_months INTEGER,
        remaining_months INTEGER,
        transaction_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_recurring_donations_next_due
       ON recurring_donations (next_due_date)
       WHERE status = 'active'`
    );

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_recurring_donations_wallet
       ON recurring_donations (wallet_address)`
    );

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_recurring_donations_project
       ON recurring_donations (project_id)`
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS recurring_donations");
  },
};
