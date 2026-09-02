"use strict";
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const { signToken, adminRequired } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { buildDigestHtml, buildDigestText } = require("../services/digestQueue");
const { logAdminAction } = require("../services/audit");
const { VALID_CATEGORIES, STELLAR_PUBLIC_KEY_RE } = require("../config/constants");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const loginLimiter = createRateLimiter(10, 15, "admin-login");

const TOKEN_EXPIRY = "1h";
const REFRESH_EXPIRY = "24h";

/**
 * Authenticate an administrator and issue session tokens.
 *
 * @route POST /api/admin/login
 * @param {import('express').Request} req - Express request with admin credentials.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends the token payload or an auth error.
 * @throws {Error} If the admin credentials are invalid or the server is not configured.
 */
router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const adminUser = process.env.ADMIN_USERNAME || "admin";
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminPass) {
    return res.status(503).json({ error: "Admin authentication not configured on this server" });
  }

  if (username !== adminUser || password !== adminPass) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({ role: "admin", sub: username }, TOKEN_EXPIRY);
  const refreshToken = signToken({ role: "admin", sub: username, type: "refresh" }, REFRESH_EXPIRY);
  return res.json({ success: true, data: { token, refreshToken, expiresIn: 3600 } });
});

/**
 * Refresh an administrator access token using a refresh token.
 *
 * @route POST /api/admin/refresh
 * @param {import('express').Request} req - Express request carrying the refresh token.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends a new access token or an auth error.
 * @throws {Error} If the refresh token is missing or invalid.
 */
router.post("/refresh", (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  try {
    const decoded = require("../middleware/auth").verifyToken(refreshToken);
    if (decoded.type !== "refresh") {
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    const token = signToken({ role: "admin", sub: decoded.sub }, TOKEN_EXPIRY);
    res.json({
      success: true,
      data: { token, expiresIn: 3600 },
    });
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

/**
 * Return the authenticated admin identity.
 *
 * @route GET /api/admin/me
 * @param {import('express').Request} req - Express request with the authenticated admin context.
 * @param {import('express').Response} res - Express response object.
 * @returns {void} Sends the admin profile payload.
 * @throws {Error} If the request is missing a valid bearer token.
 */
router.get("/me", adminRequired, (req, res) => {
  res.json({
    success: true,
    data: {
      username: req.admin.sub,
      role: req.admin.role,
    },
  });
});

/**
 * Query the admin audit log with optional filters and pagination.
 *
 * @route GET /api/admin/audit-log
 * @param {import('express').Request} req - Express request with audit log filters.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the audit log page and metadata.
 * @throws {Error} If the audit log query fails.
 */
router.get("/audit-log", adminRequired, async (req, res, next) => {
  try {
    const { actor, action, page = "1", pageSize = "50" } = req.query;
    const where = [];
    const values = [];

    if (actor && typeof actor === "string") {
      values.push(actor);
      where.push(`actor = $${values.length}`);
    }
    if (action && typeof action === "string") {
      values.push(action);
      where.push(`action = $${values.length}`);
    }

    const limit = Math.min(Number.parseInt(pageSize, 10) || 50, 200);
    const offset = (Math.max(Number.parseInt(page, 10) || 1, 1) - 1) * limit;
    values.push(limit, offset);

    // eslint-disable-next-line sql-injection/no-sql-injection
    let query = "SELECT id, actor, action, target_type, target_id, metadata, ip_address, created_at FROM admin_audit_log";
    if (where.length) {
      // eslint-disable-next-line sql-injection/no-sql-injection
      query += " WHERE " + where.join(" AND ");
    }
    query += ` ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

    // eslint-disable-next-line sql-injection/no-sql-injection
    const result = await pool.query(query, values);

    let countQuery = "SELECT COUNT(*) AS total FROM admin_audit_log";
    if (where.length) {
      // eslint-disable-next-line sql-injection/no-sql-injection
      countQuery += " WHERE " + where.join(" AND ");
    }
    // eslint-disable-next-line sql-injection/no-sql-injection
    const countResult = await pool.query(countQuery, values.slice(0, -2));

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      pageSize: limit,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Render a monthly digest email body for admin review without sending it.
 *
 * @route POST /api/admin/digest/preview
 * @param {import('express').Request} req - Express request with projectId and month.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the HTML digest body as text/html.
 */
router.post("/digest/preview", adminRequired, async (req, res, next) => {
  try {
    const { projectId, month } = req.body || {};

    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    if (!month || typeof month !== "string") {
      return res.status(400).json({ error: "month is required in YYYY-MM format" });
    }

    const monthMatch = /^\d{4}-(0[1-9]|1[0-2])$/.exec(month);
    if (!monthMatch) {
      return res.status(400).json({ error: "month must be in YYYY-MM format" });
    }

    const [year, monthIndex] = month.split("-").map(Number);
    const monthStart = new Date(Date.UTC(year, monthIndex - 1, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex, 1));
    const monthLabel = monthStart.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

    const projectResult = await pool.query(
      "SELECT id, name, co2_offset_kg FROM projects WHERE id = $1",
      [projectId],
    );

    if (!projectResult.rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    const project = projectResult.rows[0];

    const statsResult = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN currency = 'XLM' THEN amount_xlm ELSE 0 END), 0) AS raised_xlm
       FROM donations
       WHERE project_id = $1
         AND created_at >= $2
         AND created_at < $3`,
      [project.id, monthStart.toISOString(), monthEnd.toISOString()],
    );

    const raisedXLM = parseFloat(statsResult.rows[0].raised_xlm || "0").toFixed(2);

    const lifetimeTotResult = await pool.query(
      "SELECT COALESCE(SUM(amount_xlm), 0) AS total FROM donations WHERE project_id = $1 AND currency = 'XLM'",
      [project.id],
    );
    const lifetimeXLM = parseFloat(lifetimeTotResult.rows[0].total || "0");
    const co2Total = parseInt(project.co2_offset_kg, 10) || 0;
    const co2OffsetKg = lifetimeXLM > 0
      ? Math.round((parseFloat(raisedXLM) / lifetimeXLM) * co2Total)
      : 0;

    const milestonesResult = await pool.query(
      `SELECT title, percentage FROM project_milestones
       WHERE project_id = $1
         AND reached_at >= $2
         AND reached_at < $3
       ORDER BY percentage ASC`,
      [project.id, monthStart.toISOString(), monthEnd.toISOString()],
    );

    const updatesResult = await pool.query(
      `SELECT title, body FROM project_updates
       WHERE project_id = $1
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at DESC
       LIMIT 5`,
      [project.id, monthStart.toISOString(), monthEnd.toISOString()],
    );

    const projectUrl = `${process.env.APP_URL || "http://localhost:3000"}/projects/${project.id}`;
    const html = buildDigestHtml({
      project,
      stats: { raisedXLM, co2OffsetKg },
      milestones: milestonesResult.rows,
      updates: updatesResult.rows,
      projectUrl,
      monthLabel,
    });

    res.type("text/html");
    return res.send(html);
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/admin/projects/import
 * Bulk import projects from a CSV file.
 * Accepts a multipart/form-data upload with a single "file" field.
 * Expected CSV columns: name,description,category,location,walletAddress,goalXLM,co2PerXLM
 *
 * Each row is validated independently (category enum, Stellar G-address format,
 * numeric fields) so a single bad row does not abort the batch. The response
 * reports how many rows imported, how many failed, and per-row error details.
 * All admin actions are written to the audit trail.
 *
 * @returns { { imported: number, failed: number, errors: Array<{ row: number, error: string }> } }
 */
router.post("/projects/import", adminRequired, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required as multipart field 'file'" });
    }

    const csvText = req.file.buffer.toString("utf-8").trim();
    if (!csvText) {
      return res.status(400).json({ error: "CSV file is empty" });
    }

    const rows = parseCSV(csvText);
    if (rows.length < 2) {
      return res.status(400).json({ error: "CSV must include a header row and at least one data row" });
    }

    const header = rows[0].map((h) => h.trim());
    const expectedColumns = ["name", "description", "category", "location", "walletAddress", "goalXLM", "co2PerXLM"];

    // Validate header row
    const missingCols = expectedColumns.filter((col) => !header.includes(col));
    if (missingCols.length > 0) {
      return res.status(400).json({
        error: `Missing required CSV columns: ${missingCols.join(", ")}. Expected: ${expectedColumns.join(", ")}`,
      });
    }

    const idx = {};
    for (const col of expectedColumns) {
      idx[col] = header.indexOf(col);
    }

    const imported = [];
    const errors = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1; // 1-based in CSV (row 1 = header)
      const rowErrors = [];

      const name = (row[idx.name] || "").trim();
      const description = (row[idx.description] || "").trim();
      const category = (row[idx.category] || "").trim();
      const location = (row[idx.location] || "").trim();
      const walletAddress = (row[idx.walletAddress] || "").trim();
      const goalXLM = (row[idx.goalXLM] || "").trim();
      const co2PerXLM = (row[idx.co2PerXLM] || "").trim();

      // Validate
      if (!name || name.length < 3 || name.length > 120) {
        rowErrors.push(`name must be 3-120 characters (got "${name.slice(0, 30)}")`);
      }
      if (!description || description.length < 10 || description.length > 5000) {
        rowErrors.push("description must be 10-5000 characters");
      }
      if (!category || !VALID_CATEGORIES.includes(category)) {
        rowErrors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")} (got "${category}")`);
      }
      if (!location || location.length < 2 || location.length > 200) {
        rowErrors.push("location must be 2-200 characters");
      }
      if (!walletAddress) {
        rowErrors.push("walletAddress is required");
      } else if (!STELLAR_PUBLIC_KEY_RE.test(walletAddress)) {
        rowErrors.push(`walletAddress must be a valid Stellar public key (starts with G, 56 chars): "${walletAddress.slice(0, 12)}..."`);
      }
      const goal = Number.parseFloat(goalXLM);
      if (!goalXLM || !Number.isFinite(goal) || goal < 0) {
        rowErrors.push(`goalXLM must be a non-negative number (got "${goalXLM}")`);
      }
      const co2 = Number.parseFloat(co2PerXLM);
      if (!co2PerXLM || !Number.isFinite(co2) || co2 < 0) {
        rowErrors.push(`co2PerXLM must be a non-negative number (got "${co2PerXLM}")`);
      }

      if (rowErrors.length > 0) {
        errors.push({ row: rowNum, error: rowErrors.join("; ") });
        continue;
      }

      // Insert
      try {
        const id = uuid();
        await pool.query(
          `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, co2_per_xlm)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, name, description, category, location, walletAddress, goal.toFixed(7), co2.toFixed(7)],
        );
        imported.push(id);
      } catch (dbErr) {
        errors.push({ row: rowNum, error: `Database error: ${dbErr.message}` });
      }
    }

    logAdminAction({
      actor: req.admin?.sub || "unknown",
      action: "admin.projects.import",
      targetType: "project",
      targetId: "csv-import",
      metadata: { imported: imported.length, failed: errors.length, totalRows: rows.length - 1 },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        imported: imported.length,
        failed: errors.length,
        errors,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Simple CSV parser that handles quoted fields and commas.
 *
 * @param {string} text - Raw CSV content.
 * @returns {string[][]} Array of rows, each row an array of column values.
 */
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\"") {
        if (inQuotes && line[i + 1] === "\"") {
          current += "\"";
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    rows.push(fields);
  }
  return rows;
}

module.exports = router;
