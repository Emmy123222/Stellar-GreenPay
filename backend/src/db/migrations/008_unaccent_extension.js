/**
 * 008_unaccent_extension.js
 *
 * Adds the unaccent extension to support case-insensitive, accent-insensitive
 * search for projects.
 */
"use strict";

module.exports = {
  async up(client) {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS unaccent;
    `);
  },

  async down(client) {
    await client.query(`
      DROP EXTENSION IF EXISTS unaccent;
    `);
  },
};
