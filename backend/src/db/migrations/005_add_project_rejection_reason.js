"use strict";

module.exports = {
  name: "005_add_project_rejection_reason",

  async up(client) {
    await client.query(
      "ALTER TABLE projects ADD COLUMN IF NOT EXISTS rejection_reason TEXT"
    );
  },

  async down(client) {
    await client.query(
      "ALTER TABLE projects DROP COLUMN IF EXISTS rejection_reason"
    );
  },
};
