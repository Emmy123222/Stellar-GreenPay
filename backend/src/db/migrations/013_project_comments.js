"use strict";

/**
 * 013_project_comments
 *
 * Donor comments on project pages (#1662). Rows are written by
 * POST /api/comments after text moderation (src/services/moderation.js →
 * moderateText). `moderation_status` mirrors update_images.status:
 *   approved        — shown in the public thread
 *   pending_review  — stored, hidden until an admin approves it
 * Rejected comments are never stored. Deletes are soft (deleted_at /
 * deleted_by) so moderators keep the audit trail.
 */
module.exports = {
  name: "013_project_comments",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_comments (
        id                 UUID PRIMARY KEY,
        project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        author_address     TEXT NOT NULL,
        body               TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
        moderation_status  TEXT NOT NULL DEFAULT 'approved'
                           CHECK (moderation_status IN ('approved', 'pending_review')),
        moderation_labels  JSONB NOT NULL DEFAULT '[]'::jsonb,
        deleted_at         TIMESTAMPTZ,
        deleted_by         TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Public thread query: visible comments for one project, newest first.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_project_comments_thread
      ON project_comments (project_id, created_at DESC, id DESC)
      WHERE deleted_at IS NULL AND moderation_status = 'approved'
    `);
    // Admin review queue.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_project_comments_pending
      ON project_comments (created_at)
      WHERE deleted_at IS NULL AND moderation_status = 'pending_review'
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_project_comments_pending");
    await client.query("DROP INDEX IF EXISTS idx_project_comments_thread");
    await client.query("DROP TABLE IF EXISTS project_comments");
  },
};
