/**
 * src/routes/comments.js — donor comments on project pages (#1662)
 *
 * GET    /api/comments/project/:projectId  — public thread (cursor pagination)
 * POST   /api/comments                     — post a comment (wallet-authenticated donor)
 * DELETE /api/comments/:id                 — soft-delete (comment author or admin)
 * GET    /api/comments/pending             — moderation queue (admin)
 * POST   /api/comments/:id/approve         — publish a pending comment (admin)
 *
 * Creation runs the text through moderation.moderateText() before anything is
 * written, following the same pipeline POST /api/updates uses for images:
 *   rejected        → 422 { code: "comment_rejected" }, nothing stored
 *   pending_review  → 201, stored but hidden from the public thread
 *   approved        → 201, visible immediately
 * Creation is rate limited per wallet (COMMENTS_RATE_LIMIT per 10 minutes).
 */
"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const moderation = require("../services/moderation");
const { createRateLimiter, ipKeyGenerator } = require("../middleware/rateLimiter");
const {
  walletAuthRequired,
  walletOrAdminRequired,
  adminTokenRequired,
} = require("../middleware/auth");

const MAX_COMMENT_LENGTH = 1000;
const COMMENT_RATE_WINDOW_MINUTES = 10;

const configuredCommentLimit = Number.parseInt(process.env.COMMENTS_RATE_LIMIT || "5", 10);
const commentLimiter = createRateLimiter(
  Number.isFinite(configuredCommentLimit) && configuredCommentLimit > 0 ? configuredCommentLimit : 5,
  COMMENT_RATE_WINDOW_MINUTES,
  "comments",
  // Mounted after walletAuthRequired, so the bucket is the donor's wallet —
  // switching IPs doesn't reset it and donors behind one NAT don't share it.
  { keyGenerator: (req) => req.walletAddress || ipKeyGenerator(req.ip || "") },
);

function mapCommentRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    authorAddress: row.author_address,
    authorDisplayName: row.author_display_name || null,
    body: row.body,
    moderationStatus: row.moderation_status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Strip control characters (keeping newlines/tabs) and trim. */
function normaliseBody(body) {
  // eslint-disable-next-line no-control-regex
  return body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

// GET /api/comments/pending — admin review queue. Registered before
// "/:id" style routes so "pending" is never captured as an id.
router.get("/pending", adminTokenRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const result = await pool.query(
      `SELECT c.*, pr.display_name AS author_display_name
       FROM project_comments c
       LEFT JOIN profiles pr ON pr.public_key = c.author_address
       WHERE c.deleted_at IS NULL AND c.moderation_status = 'pending_review'
       ORDER BY c.created_at ASC
       LIMIT $1`,
      [limit],
    );
    res.json({
      success: true,
      data: result.rows.map((row) => ({ ...mapCommentRow(row), moderationLabels: row.moderation_labels || [] })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/comments/project/:projectId — public, newest first.
router.get("/project/:projectId", async (req, res, next) => {
  try {
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const values = [req.params.projectId];
    const where = [
      "c.project_id = $1",
      "c.deleted_at IS NULL",
      "c.moderation_status = 'approved'",
    ];

    if (req.query.cursor) {
      let cursorData;
      try {
        cursorData = JSON.parse(Buffer.from(String(req.query.cursor), "base64").toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      if (!cursorData || !cursorData.created_at || !cursorData.id) {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      values.push(cursorData.created_at, cursorData.id);
      where.push(
        "(c.created_at < $2::timestamptz OR (c.created_at = $2::timestamptz AND c.id < $3))",
      );
    }

    values.push(pageSize + 1);
    const result = await pool.query(
      `SELECT c.*, pr.display_name AS author_display_name
       FROM project_comments c
       LEFT JOIN profiles pr ON pr.public_key = c.author_address
       WHERE ${where.join(" AND ")}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $${values.length}`,
      values,
    );

    const hasMore = result.rows.length > pageSize;
    const page = result.rows.slice(0, pageSize);
    const last = page[page.length - 1];
    const nextCursor = hasMore
      ? Buffer.from(
        JSON.stringify({ created_at: new Date(last.created_at).toISOString(), id: last.id }),
      ).toString("base64")
      : null;

    res.json({
      success: true,
      data: page.map(mapCommentRow),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/comments — { projectId, body }
router.post("/", walletAuthRequired, commentLimiter, async (req, res, next) => {
  try {
    const { projectId, body } = req.body || {};

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (typeof body !== "string") {
      return res.status(400).json({ error: "body is required" });
    }
    const text = normaliseBody(body);
    if (!text) {
      return res.status(400).json({ error: "body is required" });
    }
    if (text.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `body must be at most ${MAX_COMMENT_LENGTH} characters` });
    }

    const authorAddress = req.walletAddress;

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Same rule as ratings: only wallets with a recorded donation to this
    // project may comment. The address comes from the verified wallet token.
    const donationResult = await pool.query(
      `SELECT 1 FROM donations
       WHERE project_id = $1 AND donor_address = $2
       LIMIT 1`,
      [projectId, authorAddress],
    );
    if (!donationResult.rows[0]) {
      return res.status(403).json({ error: "Only donors who have donated to this project can comment" });
    }

    // Moderate BEFORE anything is persisted.
    const verdict = moderation.moderateText({ text });
    if (verdict.blocked) {
      return res.status(422).json({
        error: verdict.reason || "The comment failed content moderation.",
        code: "comment_rejected",
      });
    }

    const status = verdict.flaggedForReview
      ? moderation.STATUS.PENDING_REVIEW
      : moderation.STATUS.APPROVED;

    const insertResult = await pool.query(
      `INSERT INTO project_comments (id, project_id, author_address, body, moderation_status, moderation_labels)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [uuid(), projectId, authorAddress, text, status, JSON.stringify(verdict.labels || [])],
    );

    const comment = mapCommentRow(insertResult.rows[0]);
    res.status(201).json({
      success: true,
      data: verdict.flaggedForReview
        ? { ...comment, moderation: moderation.moderationSummary(verdict) }
        : comment,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/comments/:id/approve — admin publishes a pending comment.
router.post("/:id/approve", adminTokenRequired, async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE project_comments
       SET moderation_status = 'approved', updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [req.params.id],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Comment not found" });
    }
    res.json({ success: true, data: mapCommentRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/comments/:id — soft delete by the author or an admin.
router.delete("/:id", walletOrAdminRequired, async (req, res, next) => {
  try {
    const existing = await pool.query(
      "SELECT id, author_address, deleted_at FROM project_comments WHERE id = $1",
      [req.params.id],
    );
    const row = existing.rows[0];
    if (!row || row.deleted_at) {
      return res.status(404).json({ error: "Comment not found" });
    }
    if (!req.admin && row.author_address !== req.walletAddress) {
      return res.status(403).json({ error: "Only the comment author or an admin can delete it" });
    }

    const deletedBy = req.admin ? `admin:${req.admin.sub || "admin"}` : req.walletAddress;
    await pool.query(
      `UPDATE project_comments
       SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id, deletedBy],
    );
    res.json({ success: true, data: { id: row.id, deleted: true } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.mapCommentRow = mapCommentRow;
