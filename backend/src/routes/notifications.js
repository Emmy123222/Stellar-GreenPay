/**
 * src/routes/notifications.js
 * POST /api/notifications/register      — register device token
 * POST /api/notifications/follow        — follow a project
 * POST /api/notifications/unfollow      — unfollow a project
 * GET  /api/notifications/follows       — get user's followed projects
 * GET  /api/notifications/unread-count  — unread project update count for a device
 */
"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");

function parseLastSeen(value) {
  if (!value || typeof value !== "string") return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseUnreadCount(row) {
  const value = row?.unread_count ?? row?.count ?? 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// GET /api/notifications/unread-count
// Return the number of unread project updates for projects followed by a device token.
router.get("/unread-count", async (req, res, next) => {
  try {
    const { token, lastSeen } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token query parameter is required" });
    }

    const lastSeenAt = parseLastSeen(lastSeen);
    if (lastSeen !== undefined && !lastSeenAt) {
      return res.status(400).json({ error: "lastSeen must be a valid ISO-8601 timestamp" });
    }

    const tokenResult = await pool.query(
      "SELECT id FROM device_tokens WHERE token = $1",
      [token]
    );

    if (!tokenResult.rows[0]) {
      return res.status(404).json({ error: "Device token not found" });
    }

    const params = [tokenResult.rows[0].id];
    let unreadSinceClause = "";

    if (lastSeenAt) {
      params.push(lastSeenAt.toISOString());
      unreadSinceClause = `AND pu.created_at > $${params.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS unread_count
       FROM project_updates pu
       JOIN project_follows pf ON pf.project_id = pu.project_id
       WHERE pf.device_token_id = $1
       ${unreadSinceClause}`,
      params
    );

    res.json({ unreadCount: parseUnreadCount(countResult.rows[0]) });
  } catch (e) {
    next(e);
  }
});

// POST /api/notifications/register
// Register or update a device token
router.post("/register", async (req, res, next) => {
  try {
    const { token, platform, walletAddress } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token is required" });
    }
    if (!platform || typeof platform !== "string") {
      return res.status(400).json({ error: "platform is required (ios/android)" });
    }
    if (!["ios", "android"].includes(platform.toLowerCase())) {
      return res.status(400).json({ error: "platform must be either ios or android" });
    }

    const normalizedPlatform = platform.toLowerCase();

    // Check if token exists
    const existingResult = await pool.query(
      "SELECT * FROM device_tokens WHERE token = $1",
      [token]
    );

    if (existingResult.rows[0]) {
      // Update existing token
      await pool.query(
        `UPDATE device_tokens 
         SET platform = $1, wallet_address = $2, updated_at = NOW()
         WHERE token = $3`,
        [normalizedPlatform, walletAddress || null, token]
      );
      res.json({ success: true, data: { tokenId: existingResult.rows[0].id } });
    } else {
      // Insert new token
      const id = uuidv4();
      await pool.query(
        `INSERT INTO device_tokens (id, token, platform, wallet_address)
         VALUES ($1, $2, $3, $4)`,
        [id, token, normalizedPlatform, walletAddress || null]
      );
      res.json({ success: true, data: { tokenId: id } });
    }
  } catch (e) {
    next(e);
  }
});

// POST /api/notifications/follow
// Follow a project for push notifications
router.post("/follow", async (req, res, next) => {
  try {
    const { projectId, token, walletAddress } = req.body;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token is required" });
    }

    // Get device token ID
    const tokenResult = await pool.query(
      "SELECT id FROM device_tokens WHERE token = $1",
      [token]
    );

    if (!tokenResult.rows[0]) {
      return res.status(404).json({ error: "Device token not found. Please register first." });
    }

    const deviceId = tokenResult.rows[0].id;

    // Check if project exists
    const projectResult = await pool.query(
      "SELECT id FROM projects WHERE id = $1",
      [projectId]
    );

    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Check if already following
    const existingFollow = await pool.query(
      "SELECT * FROM project_follows WHERE project_id = $1 AND device_token_id = $2",
      [projectId, deviceId]
    );

    if (existingFollow.rows[0]) {
      return res.json({ success: true, message: "Already following this project" });
    }

    // Create follow relationship
    const followId = uuidv4();
    await pool.query(
      `INSERT INTO project_follows (id, project_id, device_token_id, wallet_address)
       VALUES ($1, $2, $3, $4)`,
      [followId, projectId, deviceId, walletAddress || null]
    );

    res.status(201).json({ success: true, data: { followId } });
  } catch (e) {
    next(e);
  }
});

// POST /api/notifications/unfollow
// Unfollow a project
router.post("/unfollow", async (req, res, next) => {
  try {
    const { projectId, token } = req.body;

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token is required" });
    }

    // Get device token ID
    const tokenResult = await pool.query(
      "SELECT id FROM device_tokens WHERE token = $1",
      [token]
    );

    if (!tokenResult.rows[0]) {
      return res.status(404).json({ error: "Device token not found" });
    }

    const deviceId = tokenResult.rows[0].id;

    // Delete follow relationship
    const result = await pool.query(
      "DELETE FROM project_follows WHERE project_id = $1 AND device_token_id = $2",
      [projectId, deviceId]
    );

    res.json({ success: true, deleted: result.rowCount > 0 });
  } catch (e) {
    next(e);
  }
});

// GET /api/notifications/follows
// Get all projects followed by a device
router.get("/follows", async (req, res, next) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token query parameter is required" });
    }

    // Get device token ID
    const tokenResult = await pool.query(
      "SELECT id FROM device_tokens WHERE token = $1",
      [token]
    );

    if (!tokenResult.rows[0]) {
      return res.status(404).json({ error: "Device token not found" });
    }

    const deviceId = tokenResult.rows[0].id;

    // Get followed projects
    const result = await pool.query(
      `SELECT p.id, p.name, p.category, p.location, p.description, pf.created_at as followed_at
       FROM project_follows pf
       JOIN projects p ON pf.project_id = p.id
       WHERE pf.device_token_id = $1
       ORDER BY pf.created_at DESC`,
      [deviceId]
    );

    res.json({ success: true, data: result.rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
