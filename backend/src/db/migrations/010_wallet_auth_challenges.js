"use strict";

/**
 * 010_wallet_auth_challenges
 *
 * One-time challenges used by the wallet-signature authentication flow
 * (POST /api/auth/challenge → sign a transaction whose memo is the
 * challenge → POST /api/auth/token). Each nonce is single-use and
 * short-lived, which prevents replay of a captured signed transaction.
 */
module.exports = {
  name: "010_wallet_auth_challenges",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
        nonce         TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        expires_at    TIMESTAMPTZ NOT NULL,
        consumed_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_wallet
      ON wallet_auth_challenges (wallet_address)
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_wallet_auth_challenges_wallet");
    await client.query("DROP TABLE IF EXISTS wallet_auth_challenges");
  },
};
