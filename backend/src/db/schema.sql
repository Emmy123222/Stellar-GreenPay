-- projects: core project registry. Central entity; every other table
-- references projects.id. Status lifecycle: active → completed / cancelled.
-- on_chain_verified reflects Stellar anchor verification.
-- raised_xlm / donor_count / co2_offset_kg are summary counters updated by triggers.
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

-- AI summary cache: filled on demand by POST /api/projects/:id/generate-summary,
-- read by GET /api/projects/:id and rendered as a highlighted card on the
-- project detail page. ai_summary_source_hash stores a SHA-256 of the
-- description that produced the summary so the UI can show a "needs refresh"
-- hint when the description has been edited since.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary             TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary_generated_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary_model        TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary_source_hash  TEXT;

-- donations: immutable donation ledger. Each row is a single
-- contribution from donor_address to a project. transaction_hash must be
-- unique (one Stellar payment → one donation). No updated_at column —
-- records are never mutated after insert.
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

-- profiles: aggregated donor stats and public profile for a Stellar wallet.
-- total_donated_xlm and projects_supported are computed counters kept in
-- sync by triggers on donations. badges is a JSONB array of earned badge IDs.
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

-- project_updates: news / blog posts published by project owners. Listed
-- on the project detail page in reverse chronological order.
CREATE TABLE IF NOT EXISTS project_updates (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_subscriptions: email-based subscriptions to project updates.
-- UNIQUE(project_id, email) prevents duplicate sign-ups.
CREATE TABLE IF NOT EXISTS project_subscriptions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  donor_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, email)
);

-- jobs: freelance jobs using Stellar escrow. Client deposits
-- amount_escrow_xlm; the job sits in_escrow until the client releases funds
-- (release_transaction_hash is set), transitioning to released. The escrow
-- pattern ties Stellar payment lifecycles to off-chain job completion.
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
);

-- project_campaigns: time-boxed fundraising campaigns for a project,
-- each with its own goal and deadline.
CREATE TABLE IF NOT EXISTS project_campaigns (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  goal_xlm NUMERIC(20, 7) NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_milestones: percentage-based funding milestones for a project.
-- reached_at + transaction_hash are set when the milestone is met on-chain.
CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  percentage INTEGER NOT NULL,
  title TEXT NOT NULL,
  reached_at TIMESTAMPTZ,
  transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_ratings: 1-5 star ratings with optional review from donors.
-- UNIQUE(project_id, donor_address) ensures one rating per donor per project.
CREATE TABLE IF NOT EXISTS project_ratings (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  donor_address TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, donor_address)
);

-- donation_matches: matching offer contracts. A matcher pledges to multiply
-- donations up to cap_xlm by multiplier (e.g. 2×). matched_xlm tracks the
-- total matched so far; expires_at ends the offer period.
CREATE TABLE IF NOT EXISTS donation_matches (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  matcher_address TEXT NOT NULL,
  cap_xlm NUMERIC(20, 7) NOT NULL,
  multiplier INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  matched_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- device_tokens: push notification device registrations. token is the FCM /
-- APNs device token; platform is 'ios' or 'android'. wallet_address links
-- the device to a profile when known.
CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  wallet_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_follows: many-to-many join between projects and device_tokens.
-- A device "follows" a project to receive push notifications.
-- UNIQUE(project_id, device_token_id) prevents duplicate follows.
CREATE TABLE IF NOT EXISTS project_follows (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_token_id UUID NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  wallet_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, device_token_id)
);

-- Community comments on project pages (v1.4)
-- Only wallets with ≥1 donation to the project may post.
-- Threaded replies are supported via parent_id (one level of nesting).
CREATE TABLE IF NOT EXISTS project_comments (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES project_comments(id) ON DELETE CASCADE,
  donor_address TEXT NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_comments_project_id ON project_comments(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_comments_parent_id  ON project_comments(parent_id);
