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

    const co2Result = await pool.query(
      `SELECT COALESCE(
        SUM(
          CASE
            WHEN p.raised_xlm > 0 THEN (d.amount_xlm * (p.co2_offset_kg::numeric / p.raised_xlm))
            ELSE 0
          END
        ),
        0
      ) AS total_co2_offset_kg
       FROM donations d
       JOIN projects p ON p.id = d.project_id
       WHERE d.donor_address = $1
         AND (d.currency = 'XLM' OR d.currency IS NULL)`,
      [req.params.publicKey],
    );
    const totalCo2OffsetKg = Math.round(
      Number.parseFloat(co2Result.rows[0]?.total_co2_offset_kg || "0"),
    );

    res.json({
      success: true,
      data: { ...mapProfileRow(result.rows[0]), totalCo2OffsetKg },
    });
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
