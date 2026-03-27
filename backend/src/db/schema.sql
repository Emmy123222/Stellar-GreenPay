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
);

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
);

CREATE TABLE IF NOT EXISTS profiles (
  public_key TEXT PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  total_donated_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
  projects_supported INTEGER NOT NULL DEFAULT 0,
  badges JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS project_updates (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
