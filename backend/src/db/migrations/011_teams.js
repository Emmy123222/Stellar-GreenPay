"use strict";

/**
 * 011_teams
 *
 * Team giving: multiple individual wallets grouped under one named team
 * profile with a combined donation total. `teams` holds the profile and the
 * invite code used to join; `team_members` maps member wallets to a team.
 * A wallet can belong to at most one team at a time (partial unique index
 * on wallet_address), so combined totals never double-count a donor.
 */
module.exports = {
  name: "011_teams",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id          UUID PRIMARY KEY,
        name        TEXT NOT NULL,
        logo_url    TEXT,
        invite_code TEXT NOT NULL UNIQUE,
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id           UUID PRIMARY KEY,
        team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        wallet_address TEXT NOT NULL,
        joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (team_id, wallet_address)
      )
    `);
    // One team per wallet: a donor's donations count toward exactly one
    // team's combined total.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS team_members_wallet_uidx
      ON team_members (wallet_address)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_team_id
      ON team_members (team_id)
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_team_members_team_id");
    await client.query("DROP INDEX IF EXISTS team_members_wallet_uidx");
    await client.query("DROP TABLE IF EXISTS team_members");
    await client.query("DROP TABLE IF EXISTS teams");
  },
};
