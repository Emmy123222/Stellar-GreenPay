"use strict";

module.exports = {
  name: "003_recurring_donations",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_donations (
        id UUID PRIMARY KEY,
        donor_address TEXT NOT NULL,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        amount_xlm NUMERIC(20, 7) NOT NULL,
        frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
        next_due_date TIMESTAMPTZ NOT NULL,
        device_token_id UUID REFERENCES device_tokens(id) ON DELETE SET NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recurring_donations_next_due
      ON recurring_donations(next_due_date)
      WHERE active = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recurring_donations_donor
      ON recurring_donations(donor_address)
    `);
  },

  async down(client) {
    await client.query(`DROP INDEX IF EXISTS idx_recurring_donations_donor`);
    await client.query(`DROP INDEX IF EXISTS idx_recurring_donations_next_due`);
    await client.query(`DROP TABLE IF EXISTS recurring_donations`);
  },
};
