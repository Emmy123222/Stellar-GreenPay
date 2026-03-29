/**
 * src/routes/subscriptions.js
 * POST /api/subscriptions        — subscribe to project updates
 * GET  /api/subscriptions/:projectId/count — subscriber count
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/subscriptions
router.post("/", async (req, res, next) => {
  try {
    const { projectId, email, donorAddress } = req.body;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    // Verify project exists
    const proj = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (!proj.rows[0]) return res.status(404).json({ error: "Project not found" });

    await pool.query(
      `INSERT INTO project_subscriptions (id, project_id, email, donor_address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, email) DO NOTHING`,
      [uuidv4(), projectId, email.toLowerCase().trim(), donorAddress || null],
    );

    res.status(201).json({ success: true, message: "Subscribed successfully" });
  } catch (e) {
    next(e);
  }
});

// GET /api/subscriptions/:projectId/count
router.get("/:projectId/count", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM project_subscriptions WHERE project_id = $1",
      [req.params.projectId],
    );
    res.json({ success: true, count: result.rows[0].count });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
