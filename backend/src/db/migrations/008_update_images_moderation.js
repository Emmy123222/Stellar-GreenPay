/**
 * 008_update_images_moderation.js — image moderation audit log (issue #1101)
 *
 * Creates the `update_images` table, which is the audit log + admin review
 * queue for every image attached to a project update. Project owners upload
 * images through POST /api/uploads (S3, publicly readable) and reference them
 * from POST /api/updates; this table records what AWS Rekognition
 * `DetectModerationLabels` said about each of those images.
 *
 * Column notes
 *   - update_id / project_id are NULLABLE on purpose: an image is scanned when
 *     it lands in storage, which happens *before* any update row references it.
 *     src/routes/updates.js back-fills update_id once the update is created.
 *   - status is plain TEXT with a CHECK (this repo avoids Postgres enums);
 *     'pending_review' is the default so a row can never be silently approved.
 *   - moderation_labels keeps the normalised label summary
 *     [{ name, family, confidence, categories }] so a reviewer can see exactly
 *     what the API returned without re-scanning the object.
 *   - max_confidence stores the highest label confidence in percent (0–100),
 *     matching Rekognition's own units; the CHECK guards against bad writes.
 *
 * Indexes cover the two queries the service actually runs:
 *   - lookup of the latest decision for a storage key / image URL
 *     (src/services/moderation.js → getLatestModerationDecision)
 *   - the admin "needs review" queue ordered by recency.
 */
"use strict";

module.exports = {
  name: "008_update_images_moderation",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS update_images (
        id UUID PRIMARY KEY,
        update_id UUID REFERENCES project_updates(id) ON DELETE CASCADE,
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        storage_key TEXT,
        image_url TEXT NOT NULL,
        storage_backend TEXT NOT NULL DEFAULT 's3',
        status TEXT NOT NULL DEFAULT 'pending_review',
        flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE,
        provider TEXT NOT NULL DEFAULT 'aws_rekognition',
        max_confidence NUMERIC(5, 2),
        moderation_labels JSONB NOT NULL DEFAULT '[]'::JSONB,
        reason TEXT,
        reviewed_by TEXT,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT update_images_status_check
          CHECK (status IN ('approved', 'rejected', 'pending_review')),
        CONSTRAINT update_images_max_confidence_range
          CHECK (
            max_confidence IS NULL
            OR (max_confidence >= 0 AND max_confidence <= 100)
          )
      )
    `);

    // Latest-decision lookup at publish time (POST /api/updates).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_update_images_storage_key
        ON update_images (storage_key, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_update_images_image_url
        ON update_images (image_url, created_at DESC)
    `);
    // Admin review queue: unreviewed rows, newest first.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_update_images_pending_review
        ON update_images (created_at DESC)
        WHERE status = 'pending_review'
    `);
    // Per-update / per-project history.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_update_images_update_id
        ON update_images (update_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_update_images_project_created
        ON update_images (project_id, created_at DESC)
    `);
  },

  async down(client) {
    await client.query("DROP INDEX IF EXISTS idx_update_images_project_created");
    await client.query("DROP INDEX IF EXISTS idx_update_images_update_id");
    await client.query("DROP INDEX IF EXISTS idx_update_images_pending_review");
    await client.query("DROP INDEX IF EXISTS idx_update_images_image_url");
    await client.query("DROP INDEX IF EXISTS idx_update_images_storage_key");
    await client.query("DROP TABLE IF EXISTS update_images");
  },
};
