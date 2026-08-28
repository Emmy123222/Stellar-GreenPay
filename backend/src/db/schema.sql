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
  co2_per_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
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

-- Webhook notification support: project owners can register a URL that receives
-- signed POSTs when donation milestones are reached.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_url    TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS image_url TEXT;

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
  donor_country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_donations_donor_project ON donations(donor_address, project_id);

-- profiles: aggregated donor stats and public profile for a Stellar wallet.
-- total_donated_xlm and projects_supported are computed counters kept in
-- sync by triggers on donations. badges is a JSONB array of earned badge IDs.
CREATE TABLE IF NOT EXISTS profiles (
  public_key TEXT PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  total_donated_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0,
  projects_supported INTEGER NOT NULL DEFAULT 0,
  badges JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- project_updates: news / blog posts published by project owners. Listed
-- on the project detail page in reverse chronological order.
-- image_url is an optional link to a photo or chart uploaded via /api/uploads.
CREATE TABLE IF NOT EXISTS project_updates (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
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

-- recurring_donations: monthly pledge schedule. Each row represents a
-- donor's commitment to donate amount_xlm per month for duration_months.
-- The pg-boss daily job (recurringDonationQueue.js) processes due pledges,
-- builds Soroban transactions, and sends push/email reminders.
-- Status lifecycle: active → completed | cancelled
CREATE TABLE IF NOT EXISTS recurring_donations (
  id               UUID PRIMARY KEY,
  donor_address    TEXT NOT NULL,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount_xlm       NUMERIC(20, 7) NOT NULL CHECK (amount_xlm > 0),
  currency         TEXT NOT NULL DEFAULT 'XLM',
  next_due_date    DATE NOT NULL,
  duration_months  INTEGER NOT NULL CHECK (duration_months >= 1),
  remaining_months INTEGER NOT NULL CHECK (remaining_months >= 0),
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recurring_donations_status_check
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  CONSTRAINT recurring_donations_remaining_lte_duration
    CHECK (remaining_months <= duration_months)
);
CREATE INDEX IF NOT EXISTS recurring_donations_due_idx
  ON recurring_donations (next_due_date, status)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS recurring_donations_donor_idx
  ON recurring_donations (donor_address);
CREATE INDEX IF NOT EXISTS recurring_donations_project_idx
  ON recurring_donations (project_id);

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

-- project_follows: project follow relationships for push devices and/or wallets.
-- - Mobile push: device_token_id set (UNIQUE with project_id); wallet_address optional.
-- - Web Follow button: device_token_id NULL, wallet_address required; uniqueness
--   enforced by partial unique index (see migration 003_wallet_project_follows).
CREATE TABLE IF NOT EXISTS project_follows (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_token_id UUID REFERENCES device_tokens(id) ON DELETE CASCADE,
  wallet_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, device_token_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_follows_project_wallet_uidx
  ON project_follows (project_id, wallet_address)
  WHERE device_token_id IS NULL AND wallet_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_follows_wallet_lookup_idx
  ON project_follows (project_id, wallet_address)
  WHERE wallet_address IS NOT NULL;

-- Verification requests submitted via the /apply form on the frontend.
-- Each row represents an organisation asking the GreenPay admin team to
-- verify their climate project. Mirrors the columns of migration 002.
CREATE TABLE IF NOT EXISTS verification_requests (
  id UUID PRIMARY KEY,
  organization_name TEXT NOT NULL,
  organization_website TEXT,
  organization_country TEXT,
  contact_email TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  project_name TEXT NOT NULL,
  project_category TEXT NOT NULL,
  project_location TEXT NOT NULL,
  project_description TEXT,
  co2_per_xlm NUMERIC(20, 7) NOT NULL,
  expected_annual_tonnes_co2 NUMERIC(20, 7),
  supporting_documents JSONB NOT NULL DEFAULT '[]'::JSONB,
  storage_backend TEXT NOT NULL DEFAULT 'local',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_notes TEXT,
  reviewed_by TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT verification_requests_status_check
    CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
  CONSTRAINT verification_requests_co2_positive
    CHECK (co2_per_xlm >= 0)
);
CREATE INDEX IF NOT EXISTS verification_requests_status_idx
  ON verification_requests (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS verification_requests_wallet_idx
  ON verification_requests (wallet_address);

-- webhook_deliveries: history of outbound webhook delivery attempts.
-- Populated when milestone.reached (and similar) events are sent to a
-- project's webhook_url. Used by GET /api/webhooks/:projectId/history.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  payload JSONB NOT NULL,
  event TEXT,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  response_status INTEGER,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
  ON webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project_id
  ON webhook_deliveries (project_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_project_created
  ON webhook_deliveries (project_id, created_at DESC);

-- global_stats_mv: pre-aggregated landing-page totals refreshed by pg-boss.
CREATE MATERIALIZED VIEW IF NOT EXISTS global_stats_mv AS
SELECT
  1 AS id,
  COALESCE(SUM(raised_xlm), 0) AS total_xlm_raised,
  COALESCE(SUM(co2_offset_kg), 0)::int AS total_co2_offset_kg,
  COUNT(*)::int AS total_projects,
  COALESCE(SUM(donor_count), 0)::int AS total_donors,
  (SELECT COUNT(*)::int FROM donations) AS total_donations
FROM projects;
CREATE UNIQUE INDEX IF NOT EXISTS global_stats_mv_id_uidx ON global_stats_mv (id);
