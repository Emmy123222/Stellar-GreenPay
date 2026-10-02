"use strict";

module.exports = {
  name: "004_profile_avatar_url",

  async up(client) {
    await client.query(`
      ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);
  },

  async down(client) {
    await client.query(`
      ALTER TABLE profiles
      DROP COLUMN IF EXISTS avatar_url
    `);
  },
};
