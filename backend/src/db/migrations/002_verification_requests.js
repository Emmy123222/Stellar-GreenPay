/**
 * 002_verification_requests.js — Project verification request submissions
 *
 * Adds a `verification_requests` table used by the /apply form on the
 * frontend. Each row captures an organization's identity (name, website,
 * country, contact email, receiving wallet), the proposed project
 * (name, category, location), impact metrics (expected CO₂ offset
 * per XLM), supporting documents (JSONB array of {name,url,size,contentType}),
 * and admin review state.
 *
 * Persists requests to the table and triggers an admin email
 * notification through the email service when a row is inserted by
 * the API route (see routes/verification.js).
 */
"use strict";

module.exports = {
  name: "002_verification_requests",

  async up(client) {
    await client.query(`
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
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS verification_requests_status_idx
        ON verification_requests (status, submitted_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS verification_requests_wallet_idx
        ON verification_requests (wallet_address)
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS verification_requests_wallet_idx");
    await client.query("DROP INDEX IF EXISTS verification_requests_status_idx");
    await client.query("DROP TABLE IF EXISTS verification_requests");
  },
};
