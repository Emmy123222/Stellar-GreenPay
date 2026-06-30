"use strict";

module.exports = {
  name: "001_initial_schema",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        location TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        goal_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
        raised_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
        donor_count INTEGER NOT NULL DEFAULT 0,
        co2_offset_kg INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        on_chain_verified BOOLEAN NOT NULL DEFAULT FALSE,
        tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary TEXT`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary_generated_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary_model TEXT`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary_source_hash TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS donations (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        donor_address TEXT NOT NULL,
        amount_xlm NUMERIC(20, 7),
        amount NUMERIC(20, 7) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'XLM',
        message TEXT,
        transaction_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        public_key TEXT PRIMARY KEY,
        display_name TEXT,
        bio TEXT,
        total_donated_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
        projects_supported INTEGER NOT NULL DEFAULT 0,
        badges JSONB NOT NULL DEFAULT '[]'::JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_updates (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_subscriptions (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        donor_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, email)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        client_public_key TEXT NOT NULL,
        freelancer_public_key TEXT NOT NULL,
        amount_escrow_xlm NUMERIC(20, 7) NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_escrow',
        release_transaction_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_campaigns (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        goal_xlm NUMERIC(20, 7) NOT NULL,
        deadline TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_milestones (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        percentage INTEGER NOT NULL,
        title TEXT NOT NULL,
        reached_at TIMESTAMPTZ,
        transaction_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_ratings (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        donor_address TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        review TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, donor_address)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS donation_matches (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        matcher_address TEXT NOT NULL,
        cap_xlm NUMERIC(20, 7) NOT NULL,
        multiplier INTEGER NOT NULL DEFAULT 1,
        expires_at TIMESTAMPTZ NOT NULL,
        matched_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id UUID PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        wallet_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_follows (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        device_token_id UUID NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
        wallet_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, device_token_id)
      )
    `);
  },

  async down(client) {
    // Drop in reverse dependency order
    await client.query(`DROP TABLE IF EXISTS project_follows`);
    await client.query(`DROP TABLE IF EXISTS device_tokens`);
    await client.query(`DROP TABLE IF EXISTS donation_matches`);
    await client.query(`DROP TABLE IF EXISTS project_ratings`);
    await client.query(`DROP TABLE IF EXISTS project_milestones`);
    await client.query(`DROP TABLE IF EXISTS project_campaigns`);
    await client.query(`DROP TABLE IF EXISTS project_subscriptions`);
    await client.query(`DROP TABLE IF EXISTS project_updates`);
    await client.query(`DROP TABLE IF EXISTS jobs`);
    await client.query(`DROP TABLE IF EXISTS profiles`);
    await client.query(`DROP TABLE IF EXISTS donations`);
    await client.query(`DROP TABLE IF EXISTS projects`);
  },
};
