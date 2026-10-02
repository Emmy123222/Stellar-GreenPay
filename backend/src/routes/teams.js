/**
 * src/routes/teams.js — Team giving.
 *
 * Businesses and groups can give as a team: multiple individual wallets are
 * grouped under one named team profile, and the team's combined donation
 * total is shown on a leaderboard tab. Membership is controlled by an invite
 * code, and every mutating endpoint requires wallet authentication so the
 * backend — not the request body — decides which wallet is acting.
 */
"use strict";
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const { walletAuthRequired } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");

const MAX_TEAM_NAME_LENGTH = 100;
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{6,20}$/;

// Team creation/join are wallet-authenticated but still mutating, so they
// get their own limiter to slow down team-name and invite-code abuse.
const teamsLimiter = createRateLimiter(30, 15, "teams");

function generateInviteCode() {
  return crypto.randomBytes(6).toString("base64url");
}

function mapTeamRow(row) {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url || null,
    inviteCode: row.invite_code,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function fetchTeamWithStats(teamId) {
  const result = await pool.query(
    `SELECT t.*,
            COUNT(DISTINCT tm.wallet_address)::int AS member_count,
            COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_donated_xlm,
            COALESCE(
              SUM(
                CASE
                  WHEN pr.raised_xlm > 0 THEN (d.amount_xlm * (pr.co2_offset_kg::numeric / pr.raised_xlm))
                  ELSE 0
                END
              ),
              0
            )::NUMERIC AS total_co2_offset_kg
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     LEFT JOIN donations d ON d.donor_address = tm.wallet_address
     LEFT JOIN projects pr ON pr.id = d.project_id
     WHERE t.id = $1
     GROUP BY t.id`,
    [teamId],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...mapTeamRow(row),
    memberCount: row.member_count,
    totalDonatedXLM: row.total_donated_xlm?.toString() || "0",
    totalCO2OffsetKg: row.total_co2_offset_kg?.toString() || "0",
  };
}

/**
 * POST /api/teams
 * Create a team. The authenticated creator becomes the first member.
 * Body: { name, logoUrl?, inviteCode? }
 */
router.post("/", teamsLimiter, walletAuthRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, logoUrl, inviteCode } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (name.trim().length > MAX_TEAM_NAME_LENGTH) {
      return res.status(400).json({ error: `name must be at most ${MAX_TEAM_NAME_LENGTH} characters` });
    }
    if (logoUrl !== undefined && logoUrl !== null) {
      if (typeof logoUrl !== "string" || !/^https?:\/\/.+/.test(logoUrl)) {
        return res.status(400).json({ error: "logoUrl must be a valid http(s) URL" });
      }
    }
    let code = inviteCode;
    if (code !== undefined && code !== null) {
      if (typeof code !== "string" || !INVITE_CODE_RE.test(code)) {
        return res.status(400).json({ error: "inviteCode must be 6-20 characters (letters, numbers, -, _)" });
      }
    } else {
      code = generateInviteCode();
    }

    const walletAddress = req.walletAddress;

    // A wallet can only belong to one team — creating a second team with the
    // same wallet would double-count its donations on the leaderboard.
    const existingMembership = await pool.query(
      "SELECT 1 FROM team_members WHERE wallet_address = $1 LIMIT 1",
      [walletAddress],
    );
    if (existingMembership.rows[0]) {
      return res.status(409).json({ error: "This wallet is already a member of a team" });
    }

    const existingCode = await pool.query(
      "SELECT 1 FROM teams WHERE invite_code = $1 LIMIT 1",
      [code],
    );
    if (existingCode.rows[0]) {
      return res.status(409).json({ error: "inviteCode is already in use" });
    }

    await client.query("BEGIN");
    const teamResult = await client.query(
      `INSERT INTO teams (id, name, logo_url, invite_code, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [uuid(), name.trim(), logoUrl || null, code, walletAddress],
    );
    await client.query(
      `INSERT INTO team_members (id, team_id, wallet_address)
       VALUES ($1, $2, $3)`,
      [uuid(), teamResult.rows[0].id, walletAddress],
    );
    await client.query("COMMIT");

    const team = await fetchTeamWithStats(teamResult.rows[0].id);
    res.status(201).json({ success: true, data: team });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

/**
 * POST /api/teams/:id/join
 * Join a team with its invite code. Idempotent for existing members.
 */
router.post("/:id/join", teamsLimiter, walletAuthRequired, async (req, res, next) => {
  try {
    const { inviteCode } = req.body || {};
    if (!inviteCode || typeof inviteCode !== "string") {
      return res.status(400).json({ error: "inviteCode is required" });
    }

    const teamResult = await pool.query(
      "SELECT * FROM teams WHERE id = $1",
      [req.params.id],
    );
    if (!teamResult.rows[0]) {
      return res.status(404).json({ error: "Team not found" });
    }
    if (teamResult.rows[0].invite_code !== inviteCode) {
      return res.status(403).json({ error: "Invalid invite code" });
    }

    const walletAddress = req.walletAddress;

    const membershipResult = await pool.query(
      `INSERT INTO team_members (id, team_id, wallet_address)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, wallet_address) DO NOTHING
       RETURNING id`,
      [uuid(), req.params.id, walletAddress],
    );

    if (!membershipResult.rows[0]) {
      // Already a member of this team — idempotent success.
      const team = await fetchTeamWithStats(req.params.id);
      return res.json({ success: true, data: { ...team, isMember: true } });
    }

    const team = await fetchTeamWithStats(req.params.id);
    res.status(201).json({ success: true, data: { ...team, isMember: true } });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "This wallet is already a member of another team" });
    }
    next(e);
  }
});

/**
 * GET /api/teams/my
 * The authenticated wallet's team (with combined stats), or null.
 */
router.get("/my", walletAuthRequired, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT tm.team_id
       FROM team_members tm
       WHERE tm.wallet_address = $1
       LIMIT 1`,
      [req.walletAddress],
    );
    if (!result.rows[0]) {
      return res.json({ success: true, data: null });
    }
    const team = await fetchTeamWithStats(result.rows[0].team_id);
    res.json({ success: true, data: { ...team, isMember: true } });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/teams/:id
 * Public team profile with combined stats.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const team = await fetchTeamWithStats(req.params.id);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    res.json({ success: true, data: team });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
