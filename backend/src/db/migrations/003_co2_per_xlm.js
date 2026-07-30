"use strict";

module.exports = {
  name: "003_co2_per_xlm",

  async up(client) {
    // Add co2_per_xlm column for CSV import and CO₂-per-XLM tracking
    await client.query(
      "ALTER TABLE projects ADD COLUMN IF NOT EXISTS co2_per_xlm NUMERIC(20, 7)"
    );
  },

  async down(client) {
    await client.query("ALTER TABLE projects DROP COLUMN IF EXISTS co2_per_xlm");
  },
};
