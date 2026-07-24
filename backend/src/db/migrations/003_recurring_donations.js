"use strict";

/**
 * Migration 003: Add recurring_donations table.
 *
 * Stores recurring donation pledges made by donors. Each row represents a
 * pledge to donate `amount_xlm` (in `currency`) to a project every calendar
 * month for `duration_months` months. The pg-boss daily job in
 * recurringDonationQueue.js drives the payment schedule by inspecting
 * `next_due_date` and decrementing `remaining_months` after each cycle.
 *
 * Status lifecycle:
 *   active   → normal, payments due according to next_due_date
 *   paused   → temporarily suspended by the donor
 *   completed → remaining_months reached 0
 *   cancelled → explicitly cancelled via DELETE /api/recurring-donations/:id
 */

module.exports = {
  name: "003_recurring_donations",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_donations (
        id               UUID PRIMARY KEY,
        donor_address    TEXT NOT NULL,
        project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        amount_xlm       NUMERIC(20, 7) NOT NULL CHECK (amount_xlm > 0),
        currency         TEXT NOT NULL DEFAULT 'XLM',
        next_due_date    DATE NOT NULL,
        duration_months  INTEGER NOT NULL CHECK (duration_months >= 1),
        remaining_months INTEGER NOT NULL CHECK (remaining_months >= 0),
        status           TEXT NOT NULL DEFAULT 'active',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT recurring_donations_status_check
          CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
        CONSTRAINT recurring_donations_remaining_lte_duration
          CHECK (remaining_months <= duration_months)
      )
    `);

    // Index for the daily scheduler: find all active pledges due today or earlier
    await client.query(`
      CREATE INDEX IF NOT EXISTS recurring_donations_due_idx
        ON recurring_donations (next_due_date, status)
        WHERE status = 'active'
    `);

    // Index for donor-centric queries (GET /api/recurring-donations?donor=...)
    await client.query(`
      CREATE INDEX IF NOT EXISTS recurring_donations_donor_idx
        ON recurring_donations (donor_address)
    `);

    // Index for project-centric queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS recurring_donations_project_idx
        ON recurring_donations (project_id)
    `);
  },

  async down(client) {
    await client.query(`DROP TABLE IF EXISTS recurring_donations`);
  },
};
