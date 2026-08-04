"use strict";

module.exports = {
  name: "003_project_updates_image_url",

  async up(client) {
    await client.query(`
      ALTER TABLE project_updates
        ADD COLUMN IF NOT EXISTS image_url TEXT
    `);
  },

  async down(client) {
    await client.query(`
      ALTER TABLE project_updates
        DROP COLUMN IF EXISTS image_url
    `);
  },
};
