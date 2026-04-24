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

module.exports = router;
