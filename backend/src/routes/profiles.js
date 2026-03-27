/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool = require("../db/pool");
const { mapProfileRow } = require("../services/store");
const { createRateLimiter } = require("../middleware/rateLimiter");

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) { const e = new Error("Invalid public key"); e.status = 400; throw e; }
}

const profilePostLimiter = createRateLimiter(20, 1);

router.get("/:publicKey", async (req, res, next) => {
  try {
    validateKey(req.params.publicKey);
    const result = await pool.query("SELECT * FROM profiles WHERE public_key = $1", [req.params.publicKey]);
    if (!result.rows[0]) { const e = new Error("Profile not found"); e.status = 404; throw e; }
    res.json({ success: true, data: mapProfileRow(result.rows[0]) });
  } catch (e) { next(e); }
});

router.post("/", profilePostLimiter, async (req, res, next) => {
  try {
    const { publicKey, displayName, bio } = req.body;
    validateKey(publicKey);
    const trimmedDisplayName = displayName?.trim().slice(0, 30) || null;
    const trimmedBio = bio?.trim().slice(0, 300) || null;

    const result = await pool.query(
      `INSERT INTO profiles (
        public_key, display_name, bio, total_donated_xlm, projects_supported, badges, created_at, updated_at
      )
      VALUES ($1, $2, $3, 0, 0, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (public_key) DO UPDATE SET
        display_name = COALESCE($2, profiles.display_name),
        bio = COALESCE($3, profiles.bio),
        updated_at = NOW()
      RETURNING *`,
      [publicKey, trimmedDisplayName, trimmedBio],
    );

    res.json({ success: true, data: mapProfileRow(result.rows[0]) });
  } catch (e) { next(e); }
});

module.exports = router;
