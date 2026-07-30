/**
 * src/routes/ratings.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const { mapProjectRatingRow } = require("../services/store");

/**
 * POST /api/ratings
 * Submits a rating for a project.
 */
router.post("/", async (req, res, next) => {
  try {
    const { projectId, donorAddress, rating, review } = req.body;
    if (!projectId || !donorAddress || !rating) {
      return res.status(400).json({ error: "projectId, donorAddress, and rating are required" });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }

    const result = await pool.query(
      `INSERT INTO project_ratings (id, project_id, donor_address, rating, review)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, donor_address) DO UPDATE
       SET rating = EXCLUDED.rating, review = EXCLUDED.review, created_at = NOW()
       RETURNING *`,
      [uuid(), projectId, donorAddress, rating, review || null],
    );

    res.status(201).json({ success: true, data: mapProjectRatingRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/ratings/pending
 * Returns projects that the donor has donated to > 7 days ago and hasn't rated yet.
 */
router.get("/pending", async (req, res, next) => {
  try {
    const { donorAddress } = req.query;
    if (!donorAddress) {
      return res.status(400).json({ error: "donorAddress is required" });
    }

    const result = await pool.query(
      `SELECT DISTINCT p.id, p.name
       FROM projects p
       JOIN donations d ON d.project_id = p.id
       WHERE d.donor_address = $1
       AND d.created_at < NOW() - INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM project_ratings pr
         WHERE pr.project_id = p.id AND pr.donor_address = $1
       )
       LIMIT 1`,
      [donorAddress],
    );

    res.json({ success: true, data: result.rows[0] || null });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/ratings/project/:projectId
 * GET /api/ratings/:projectId
 * Returns a paginated list of individual reviews for a project.
 *
 * Query params:
 *   - limit  (default 20, max 100)
 *   - offset (default 0)
 *   - cursor (ISO timestamp, optional - for cursor-based pagination)
 *
 * Response:
 * {
 *   success: true,
 *   data: [{ donorAddress, rating, review, createdAt }],
 *   pagination: { total, limit, offset, has_more },
 *   next_cursor: "..." | null
 * }
 */
async function listProjectRatings(req, res, next) {
  try {
    const projectId = req.params.projectId || req.params.id;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const cursor = req.query.cursor;

    // Optional: verify project exists (return empty list if not, to avoid leaking existence?)
    // We'll allow empty result, but check existence to return 404 for clarity.
    const projectCheck = await pool.query(
      "SELECT id FROM projects WHERE id = $1",
      [projectId]
    );
    if (!projectCheck.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    let whereClause = "WHERE project_id = $1";
    const values = [projectId];
    let valueIdx = 2;

    if (cursor) {
      // cursor-based pagination: fetch ratings older than cursor timestamp
      const cursorDate = new Date(cursor);
      if (isNaN(cursorDate.getTime())) {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      whereClause += ` AND created_at < $${valueIdx}`;
      values.push(cursorDate.toISOString());
      valueIdx += 1;
    }

    // Get total count (for offset pagination metadata)
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM project_ratings ${whereClause}`,
      values.slice(0, cursor ? 2 : 1) // count query shouldn't include limit/offset, but keep same where
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Fetch paginated ratings
    let query;
    if (cursor) {
      // Cursor pagination
      query = `
        SELECT donor_address, rating, review, created_at
        FROM project_ratings
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${valueIdx}
      `;
      values.push(limit + 1);
    } else {
      // Offset pagination
      query = `
        SELECT donor_address, rating, review, created_at
        FROM project_ratings
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${valueIdx} OFFSET $${valueIdx + 1}
      `;
      values.push(limit + 1, offset);
    }

    const result = await pool.query(query, values);
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;

    const data = dataRows.map((row) => ({
      donorAddress: row.donor_address,
      rating: row.rating,
      review: row.review,
      createdAt: new Date(row.created_at).toISOString(),
    }));

    const nextCursor = hasMore && dataRows.length > 0
      ? dataRows[dataRows.length - 1].createdAt
      : null;

    const currentOffset = cursor ? 0 : offset;
    const response = {
      success: true,
      data,
      pagination: {
        total,
        limit,
        offset: currentOffset,
        has_more: hasMore,
      },
    };

    // Include next_cursor for cursor-based clients (matches donations API style)
    if (cursor || req.query.cursor !== undefined || hasMore) {
      response.next_cursor = nextCursor;
    }

    res.json(response);
  } catch (e) {
    next(e);
  }
}

// Support multiple URL patterns for flexibility:
// - GET /api/ratings/project/:projectId  (matches donations API style)
// - GET /api/ratings/:projectId         (simpler REST)
router.get("/project/:projectId", listProjectRatings);
router.get("/:projectId", listProjectRatings);

module.exports = router;
