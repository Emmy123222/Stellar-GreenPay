"use strict";

module.exports = {
  name: "006_add_donations_amount_index",

  async up(client) {
    await client.query("CREATE INDEX IF NOT EXISTS idx_donations_amount ON donations(amount)");
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_donations_amount");
  },
};
