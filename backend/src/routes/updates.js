/**
 * src/routes/updates.js
 * GET  /api/updates/:projectId        — list updates for a project
 * POST /api/updates                   — create update + notify subscribers (admin)
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const { mapProjectUpdateRow, mapProjectRow } = require("../services/store");
const { sendUpdateNotifications } = require("../services/email");
const { sendUpdatePushNotifications } = require("../services/push");

const { adminRequired } = require("../middleware/auth");

// POST /api/updates  (admin only)
router.post("/", adminRequired, async (req, res, next) => {
  try {
    const { projectId, title, body } = req.body;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "body is required" });
    }

    // Verify project exists
    const projResult = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
    if (!projResult.rows[0]) return res.status(404).json({ error: "Project not found" });
    const project = mapProjectRow(projResult.rows[0]);

    // Insert update
    const id = uuidv4();
    const insertResult = await pool.query(
      `INSERT INTO project_updates (id, project_id, title, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, projectId, title.trim(), body.trim()],
    );
    const update = mapProjectUpdateRow(insertResult.rows[0]);

    // Fetch subscriber emails and send notifications (non-blocking)
    pool.query(
      "SELECT email FROM project_subscriptions WHERE project_id = $1",
      [projectId],
    ).then(({ rows }) => {
      const emails = rows.map((r) => r.email);
      return sendUpdateNotifications({ project, update, emails });
    }).catch((err) => {
      console.error("[updates] Failed to send email notifications:", err.message);
    });

    // Send push notifications (non-blocking)
    sendUpdatePushNotifications({ project, update }).catch((err) => {
      console.error("[updates] Failed to send push notifications:", err.message);
    });

    res.status(201).json({ success: true, data: update });
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

module.exports = router;
