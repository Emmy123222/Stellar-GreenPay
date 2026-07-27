"use strict";

module.exports = {
  name: "003_add_verification_wallet_index",

  async up(client) {
    await client.query(
      "CREATE INDEX CONCURRENTLY idx_verification_wallet ON verification_requests(wallet_address)"
    );
  },

  async down(client) {
    await client.query("DROP INDEX CONCURRENTLY IF EXISTS idx_verification_wallet");
  },
};
