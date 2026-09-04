/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool = require("../db/pool");
const { mapProfileRow } = require("../services/store");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { sanitizedStringField, validateBody } = require("../middleware/validation");
const { z } = require("zod");

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) { const e = new Error("Invalid public key"); e.status = 400; throw e; }
}

const profilePostLimiter = createRateLimiter(20, 1, "profiles");

const avatarUrlField = z
  .union([z.string().url().max(2048), z.literal(""), z.null()])
  .optional();

const profileSchema = z.object({
  publicKey: z.string().min(1, "publicKey is required"),
  displayName: sanitizedStringField({ required: false, maxLength: 30, message: "must not contain HTML" }).optional(),
  bio: sanitizedStringField({ required: false, maxLength: 300, message: "must not contain HTML" }).optional(),
  avatarUrl: avatarUrlField,
});

const profilePatchSchema = z.object({
  displayName: sanitizedStringField({ required: false, maxLength: 30, message: "must not contain HTML" }).optional(),
  bio: sanitizedStringField({ required: false, maxLength: 300, message: "must not contain HTML" }).optional(),
  avatarUrl: avatarUrlField,
}).refine(
  (body) => body.displayName !== undefined || body.bio !== undefined || body.avatarUrl !== undefined,
  { message: "At least one of displayName, bio, or avatarUrl is required" },
);

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

router.post("/", profilePostLimiter, validateBody(profileSchema), async (req, res, next) => {
  try {
    const { publicKey, displayName, bio, avatarUrl } = req.body;
    validateKey(publicKey);
    const trimmedDisplayName = displayName?.trim().slice(0, 30) || null;
    const trimmedBio = bio?.trim().slice(0, 300) || null;
    // null/empty keeps existing avatar on conflict via COALESCE; a URL sets it.
    const normalizedAvatarUrl = avatarUrl ? String(avatarUrl).trim() : null;

    const result = await pool.query(
      `INSERT INTO profiles (
        public_key, display_name, bio, avatar_url, total_donated_xlm, projects_supported, badges, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, 0, 0, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (public_key) DO UPDATE SET
        display_name = COALESCE($2, profiles.display_name),
        bio = COALESCE($3, profiles.bio),
        avatar_url = COALESCE($4, profiles.avatar_url),
        updated_at = NOW()
      RETURNING *`,
      [publicKey, trimmedDisplayName, trimmedBio, normalizedAvatarUrl],
    );

    res.json({ success: true, data: mapProfileRow(result.rows[0]) });
  } catch (e) { next(e); }
});

/**
 * PATCH /api/profiles/:publicKey
 * Partially update displayName, bio, and/or avatarUrl for an existing profile.
 * Passing avatarUrl as "" or null clears the avatar.
 */
router.patch("/:publicKey", profilePostLimiter, validateBody(profilePatchSchema), async (req, res, next) => {
  try {
    validateKey(req.params.publicKey);

    const sets = [];
    const values = [];

    if (req.body.displayName !== undefined) {
      values.push(req.body.displayName?.trim().slice(0, 30) || null);
      sets.push(`display_name = $${values.length}`);
    }
    if (req.body.bio !== undefined) {
      values.push(req.body.bio?.trim().slice(0, 300) || null);
      sets.push(`bio = $${values.length}`);
    }
    if (req.body.avatarUrl !== undefined) {
      const avatar = req.body.avatarUrl === "" || req.body.avatarUrl === null
        ? null
        : String(req.body.avatarUrl).trim();
      values.push(avatar);
      sets.push(`avatar_url = $${values.length}`);
    }

    sets.push("updated_at = NOW()");
    values.push(req.params.publicKey);

    const result = await pool.query(
      `UPDATE profiles SET ${sets.join(", ")} WHERE public_key = $${values.length} RETURNING *`,
      values,
    );

    if (!result.rows[0]) {
      const e = new Error("Profile not found");
      e.status = 404;
      throw e;
    }

    res.json({ success: true, data: mapProfileRow(result.rows[0]) });
  } catch (e) { next(e); }
});

module.exports = router;
