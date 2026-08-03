"use strict";

module.exports = {
  name: "003_project_image_uploads",

  async up(client) {
    await client.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS image_url TEXT
    `);
  },

  async down(client) {
    await client.query(`
      ALTER TABLE projects
      DROP COLUMN IF EXISTS image_url
    `);
  },
};
