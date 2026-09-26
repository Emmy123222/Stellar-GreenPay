/**
 * 003_project_co2_per_xlm.js — Per-XLM CO₂ rate on projects
 *
 * Adds `co2_per_xlm` (grams of CO₂ offset per 1 XLM donated) to the
 * `projects` table so per-donation CO₂ impact can be calculated
 * directly from `amount_xlm * co2_per_xlm / 1000`.
 *
 * Populated when a verification request is approved (in routes/verification.js)
 * and synced from on-chain project data.
 */
"use strict";

module.exports = {
  name: "003_project_co2_per_xlm",

  async up(client) {
    await client.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS co2_per_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0
    `);
  },

  async down(client) {
    await client.query(`
      ALTER TABLE projects
        DROP COLUMN IF EXISTS co2_per_xlm
    `);
  },
};
