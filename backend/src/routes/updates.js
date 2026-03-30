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

// Simple admin key guard — set ADMIN_API_KEY in env; omit to disable auth in dev
function adminOnly(req, res, next) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return next(); // no key configured → open in dev
  const provided = req.headers["x-admin-key"] || req.body?.adminKey;
  if (provided !== key) return res.status(403).json({ error: "Forbidden" });
  next();
}

// GET /api/updates/:projectId
router.get("/:projectId", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM project_updates
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [req.params.projectId],
    );
    res.json({ success: true, data: result.rows.map(mapProjectUpdateRow) });
  } catch (e) {
    next(e);
  }
});

// POST /api/updates  (admin only)
router.post("/", adminOnly, async (req, res, next) => {
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
      console.error("[updates] Failed to send notifications:", err.message);
    });

    res.status(201).json({ success: true, data: update });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
