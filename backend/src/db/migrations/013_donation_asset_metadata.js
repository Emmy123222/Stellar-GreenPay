"use strict";

module.exports = {
  name: "013_donation_asset_metadata",
  async up(client) {
    await client.query("ALTER TABLE donations ADD COLUMN IF NOT EXISTS asset_code TEXT");
    await client.query("ALTER TABLE donations ADD COLUMN IF NOT EXISTS asset_issuer TEXT");
  },
  async down(client) {
    await client.query("ALTER TABLE donations DROP COLUMN IF EXISTS asset_issuer");
    await client.query("ALTER TABLE donations DROP COLUMN IF EXISTS asset_code");
  },
};
