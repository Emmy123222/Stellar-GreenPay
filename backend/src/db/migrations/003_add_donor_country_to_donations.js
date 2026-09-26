"use strict";

module.exports = {
  name: "003_add_donor_country_to_donations",

  async up(client) {
    await client.query("ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_country TEXT");
  },

  async down(client) {
    await client.query("ALTER TABLE donations DROP COLUMN IF EXISTS donor_country");
  },
};
