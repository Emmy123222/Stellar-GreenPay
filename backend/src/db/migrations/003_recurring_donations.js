/**
 * 003_recurring_donations.js — Recurring donation schedules
 *
 * Adds a recurring_donations table so that donors can set up weekly,
 * bi-weekly, or monthly recurring donations to their favourite projects.
 * The recurring-donation reminder queue (recurringDonationQueue.js) polls
 * next_due_date daily and sends push notifications when a payment is
 * due within the next 24 hours.
 */
"use strict";

module.exports = {
  name: "003_recurring_donations",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_donations (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        donor_address TEXT NOT NULL,
        amount_xlm NUMERIC(20, 7) NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'monthly'
          CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
        next_due_date TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'paused', 'cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recurring_donations_next_due
        ON recurring_donations (next_due_date)
        WHERE status = 'active'
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_recurring_donations_next_due");
    await client.query("DROP TABLE IF EXISTS recurring_donations");
  },
};
