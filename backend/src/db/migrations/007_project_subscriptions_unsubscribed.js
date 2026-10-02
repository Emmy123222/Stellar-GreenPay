/**
 * 007_project_subscriptions_unsubscribed.js
 *
 * Add soft-delete support to project_subscriptions:
 * - unsubscribed BOOLEAN DEFAULT FALSE tracks subscription status
 * - Allows unsubscribe history and re-subscription without data loss
 * - digestQueue filters WHERE unsubscribed = false
 */
"use strict";

module.exports = {
  async up(client) {
    await client.query(`
      ALTER TABLE project_subscriptions
      ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN NOT NULL DEFAULT FALSE
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_project_subscriptions_active
      ON project_subscriptions (project_id, email)
      WHERE unsubscribed = false
    `);
  },

  async down(client) {
    await client.query(`
      DROP INDEX IF EXISTS idx_project_subscriptions_active
    `);
    
    await client.query(`
      ALTER TABLE project_subscriptions
      DROP COLUMN IF EXISTS unsubscribed
    `);
  },
};
