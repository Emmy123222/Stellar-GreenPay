/**
 * src/routes/updates.js
 * GET  /api/updates/:projectId        — list updates for a project (cursor pagination)
 * POST /api/updates                   — create update + notify subscribers (admin)
 *
 * SECURITY (issue #1101): POST /api/updates scans `image_url` with AWS
 * Rekognition via src/services/moderation.js before the update row is created.
 *   - rejected image (Explicit Nudity / Violence above the configured
 *     confidence, default 70%)          → 422 { error, code: "image_rejected" }
 *     and NO update row is inserted.
 *   - other unsafe labels above the review threshold (default 50%)
 *     → published, but recorded in `update_images` with flagged_for_review =
 *       true and echoed as data.moderation so an admin can review it.
 *   - scanner unavailable               → 503 by default (fail-closed); see
 *     IMAGE_MODERATION_FAIL_MODE in .env.example to opt into fail-open.
 */
"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const { mapProjectUpdateRow, mapProjectRow } = require("../services/store");
const { sendUpdateNotifications } = require("../services/email");
const { sendUpdatePushNotifications } = require("../services/push");
const moderation = require("../services/moderation");

const { adminRequired } = require("../middleware/auth");

// GET /api/updates/:projectId
// Cursor pagination by (created_at, id) to support infinite scroll.
router.get("/:projectId", async (req, res, next) => {
  try {
    const { limit = 10, cursor } = req.query;
    const pageSize = Math.min(Number.parseInt(limit, 10) || 10, 100);

    const values = [req.params.projectId];
    const where = ["project_id = $1"];

    if (cursor) {
      let cursorData;
      try {
        cursorData = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      const { created_at, id } = cursorData;
      if (!created_at || !id) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      values.push(created_at, id);
      const createdAtIdx = values.length - 1;
      const idIdx = values.length;
      where.push(
        `(created_at < $${createdAtIdx} OR (created_at = $${createdAtIdx} AND id < $${idIdx}))`,
      );
    }

    values.push(pageSize + 1);
    const limitIdx = values.length;

    const result = await pool.query(
      `SELECT *
       FROM project_updates
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitIdx}`,
      values,
    );

    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);

    let nextCursor = null;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ created_at: last.created_at, id: last.id }),
      ).toString("base64");
    }

    res.json({
      success: true,
      data: pageRows.map(mapProjectUpdateRow),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/updates  (admin only)
router.post("/", adminRequired, async (req, res, next) => {
  try {
    const { projectId, title, body, image_url } = req.body;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "body is required" });
    }
    if (image_url !== undefined && image_url !== null) {
      if (typeof image_url !== "string" || !image_url.trim()) {
        return res.status(400).json({ error: "image_url must be a non-empty string" });
      }
      // Basic URL validation — must be http or https
      try {
        const parsed = new URL(image_url.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return res.status(400).json({ error: "image_url must use http or https" });
        }
      } catch {
        return res.status(400).json({ error: "image_url must be a valid URL" });
      }
    }

    // Verify project exists
    const projResult = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [projectId],
    );
    if (!projResult.rows[0])
      return res.status(404).json({ error: "Project not found" });
    const project = mapProjectRow(projResult.rows[0]);

    const id = uuidv4();
    const imageUrlValue = (image_url && image_url.trim()) ? image_url.trim() : null;

    // ── Issue #1101 — moderate the update image BEFORE anything is persisted ─
    // This is the enforcement point for images uploaded straight to S3 with a
    // presigned URL (POST /api/uploads/presign never sees the bytes). A verdict
    // recorded at upload time is reused instead of paying for a second scan.
    // moderateImage() never throws: a broken scanner becomes an `unavailable`
    // verdict handled by the configured fail mode (fail-closed by default).
    let verdict = null;
    if (imageUrlValue) {
      verdict = await moderation.moderateImage({
        imageUrl: imageUrlValue,
        storageBackend: "s3",
      });

      if (verdict.status === moderation.OUTCOME.UNAVAILABLE && verdict.blocked) {
        return res.status(503).json({
          error: verdict.reason,
          code: "image_moderation_unavailable",
        });
      }

      if (verdict.blocked) {
        // 422 (Unprocessable Content) rather than 403: the admin is authorised
        // and the payload is well-formed — it is the image's *content* that is
        // unacceptable. The update is NOT created, so the rejected image never
        // becomes publicly reachable through /api/updates.
        if (verdict.newDecision) {
          await moderation.recordModerationDecision({ ...verdict, projectId });
        }
        return res.status(422).json({
          error: verdict.reason || "The image failed content moderation.",
          code: "image_rejected",
        });
      }
    }

    // Insert update — only reached once the image (if any) has cleared moderation
    const insertResult = await pool.query(
      `INSERT INTO project_updates (id, project_id, title, body, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, projectId, title.trim(), body.trim(), imageUrlValue],
    );
    const update = mapProjectUpdateRow(insertResult.rows[0]);

    // Audit trail (issue #1101): link the decision that just cleared this
    // update to it, or log a fresh one now that an update_id exists.
    if (verdict && verdict.decisionId) {
      await moderation.attachDecisionToUpdateImage({
        decisionId: verdict.decisionId,
        updateId: id,
        projectId,
      });
    } else if (verdict && verdict.newDecision) {
      await moderation.recordModerationDecision({ ...verdict, updateId: id, projectId });
    }

    // Fetch subscriber emails and send notifications (non-blocking)
    pool
      .query("SELECT email FROM project_subscriptions WHERE project_id = $1", [
        projectId,
      ])
      .then(({ rows }) => {
        const emails = rows.map((r) => r.email);
        return sendUpdateNotifications({ project, update, emails });
      })
      .catch((err) => {
        console.error(
          "[updates] Failed to send email notifications:",
          err.message,
        );
      });

    // Send push notifications (non-blocking)
    sendUpdatePushNotifications({ project, update }).catch((err) => {
      console.error(
        "[updates] Failed to send push notifications:",
        err.message,
      );
    });

    res.status(201).json({
      success: true,
      // Flagged images stay visible to the caller (and the admin queue) so a
      // pending review can be surfaced in the UI instead of silently published.
      data:
        verdict && verdict.flaggedForReview
          ? { ...update, moderation: moderation.moderationSummary(verdict) }
          : update,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/updates/:updateId/like — toggle like
router.post("/:updateId/like", async (req, res, next) => {
  try {
    const { donorAddress } = req.body || {};
    if (!donorAddress || typeof donorAddress !== "string") {
      return res.status(400).json({ error: "donorAddress is required" });
    }

    const updateResult = await pool.query(
      "SELECT id FROM project_updates WHERE id = $1",
      [req.params.updateId],
    );
    if (!updateResult.rows[0]) {
      return res.status(404).json({ error: "Update not found" });
    }

    // Check if already liked
    const existing = await pool.query(
      "SELECT id FROM update_likes WHERE update_id = $1 AND donor_address = $2",
      [req.params.updateId, donorAddress],
    );

    if (existing.rows[0]) {
      // Unlike
      await pool.query(
        "DELETE FROM update_likes WHERE update_id = $1 AND donor_address = $2",
        [req.params.updateId, donorAddress],
      );
    } else {
      // Like
      await pool.query(
        "INSERT INTO update_likes (id, update_id, donor_address, created_at) VALUES ($1, $2, $3, NOW())",
        [require("uuid").v4(), req.params.updateId, donorAddress],
      );
    }

    // Get updated like count
    const countResult = await pool.query(
      "SELECT COUNT(*) as count FROM update_likes WHERE update_id = $1",
      [req.params.updateId],
    );

    res.json({
      success: true,
      data: {
        liked: !existing.rows[0],
        likeCount: parseInt(countResult.rows[0].count),
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/updates/:updateId/likes — get like count and user's like status
router.get("/:updateId/likes", async (req, res, next) => {
  try {
    const { donorAddress } = req.query;
    const countResult = await pool.query(
      "SELECT COUNT(*) as count FROM update_likes WHERE update_id = $1",
      [req.params.updateId],
    );
    let liked = false;
    if (donorAddress) {
      const existing = await pool.query(
        "SELECT id FROM update_likes WHERE update_id = $1 AND donor_address = $2",
        [req.params.updateId, donorAddress],
      );
      liked = !!existing.rows[0];
    }
    res.json({
      success: true,
      data: {
        likeCount: parseInt(countResult.rows[0].count),
        liked,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/updates/:projectId — list updates for a project
router.get("/:projectId", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM project_updates WHERE project_id = $1 ORDER BY created_at DESC",
      [req.params.projectId]
    );
    res.json({ success: true, data: result.rows.map(mapProjectUpdateRow) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

