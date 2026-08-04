/**
 * src/routes/recurringDonations.js
 *
 * REST API for recurring monthly donation pledges.
 *
 * Routes
 * ──────
 * POST   /api/recurring-donations        Create a new recurring pledge
 * GET    /api/recurring-donations        List pledges (filter by donor or project)
 * DELETE /api/recurring-donations/:id    Cancel a pledge
 */
"use strict";

const express = require("express");
const router  = express.Router();
const { v4: uuid } = require("uuid");
const { z }  = require("zod");
const pool   = require("../db/pool");
const logger = require("../logger");
const { createRateLimiter } = require("../middleware/rateLimiter");

const recurringLimiter = createRateLimiter(20, 1); // 20 req/min

// ── Validation helpers ────────────────────────────────────────────────────────

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKEY_RE   = /^G[A-Z0-9]{55}$/;
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;

function isValidUuid(v) { return UUID_RE.test(v); }

const createSchema = z.object({
  donorAddress:   z.string().regex(SKEY_RE,  "Invalid Stellar public key"),
  projectId:      z.string().regex(UUID_RE,  "Invalid project UUID"),
  amountXlm:      z.union([z.string(), z.number()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v) && v > 0, "amountXlm must be a positive number"),
  currency:       z.string().min(1).max(10).optional().default("XLM"),
  durationMonths: z.number().int().min(1).max(120),
  startDate:      z.string()
    .regex(DATE_RE, "startDate must be YYYY-MM-DD")
    .optional(),
});

// ── POST /api/recurring-donations ─────────────────────────────────────────────

/**
 * Create a recurring monthly donation pledge.
 *
 * @route POST /api/recurring-donations
 * @body {string}  donorAddress    Stellar public key of the donor
 * @body {string}  projectId       UUID of the target project
 * @body {number}  amountXlm       XLM amount per monthly instalment
 * @body {string}  [currency]      Currency code (default: XLM)
 * @body {number}  durationMonths  Total number of monthly instalments (1–120)
 * @body {string}  [startDate]     First due date YYYY-MM-DD (default: today)
 */
router.post("/", recurringLimiter, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }

    const { donorAddress, projectId, amountXlm, currency, durationMonths, startDate } =
      parsed.data;

    // Verify the project exists
    const projectResult = await pool.query(
      "SELECT id, name, status FROM projects WHERE id = $1",
      [projectId]
    );
    if (!projectResult.rows[0]) {
      return res.status(404).json({ success: false, error: "Project not found" });
    }
    if (projectResult.rows[0].status !== "active") {
      return res.status(400).json({ success: false, error: "Project is not active" });
    }

    // Determine first due date
    const firstDue = startDate || new Date().toISOString().slice(0, 10);

    const id = uuid();
    const result = await pool.query(
      `INSERT INTO recurring_donations
         (id, donor_address, project_id, amount_xlm, currency,
          next_due_date, duration_months, remaining_months, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $7, 'active', NOW())
       RETURNING *`,
      [id, donorAddress, projectId, amountXlm, currency, firstDue, durationMonths]
    );

    const pledge = result.rows[0];

    logger.info(
      {
        event: "recurring_donation_created",
        pledgeId: pledge.id,
        donor: donorAddress,
        project: projectId,
        amountXlm,
        durationMonths,
      },
      "[recurringDonations] Pledge created"
    );

    return res.status(201).json({ success: true, data: mapPledgeRow(pledge) });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/recurring-donations ──────────────────────────────────────────────

/**
 * List recurring donation pledges.
 *
 * @route GET /api/recurring-donations
 * @query {string}  [donor]    Filter by Stellar donor address
 * @query {string}  [project]  Filter by project UUID
 * @query {string}  [status]   Filter by status (active|paused|completed|cancelled)
 */
router.get("/", async (req, res, next) => {
  try {
    const { donor, project, status } = req.query;

    const conditions = [];
    const values     = [];

    if (donor) {
      if (!SKEY_RE.test(donor)) {
        return res.status(400).json({ success: false, error: "Invalid donor address" });
      }
      conditions.push(`rd.donor_address = $${values.length + 1}`);
      values.push(donor);
    }

    if (project) {
      if (!isValidUuid(project)) {
        return res.status(400).json({ success: false, error: "Invalid project UUID" });
      }
      conditions.push(`rd.project_id = $${values.length + 1}`);
      values.push(project);
    }

    const ALLOWED_STATUSES = new Set(["active", "paused", "completed", "cancelled"]);
    if (status) {
      if (!ALLOWED_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: "Invalid status value" });
      }
      conditions.push(`rd.status = $${values.length + 1}`);
      values.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT rd.*, p.name AS project_name
       FROM recurring_donations rd
       JOIN projects p ON rd.project_id = p.id
       ${where}
       ORDER BY rd.created_at DESC`,
      values
    );

    return res.json({ success: true, data: result.rows.map(mapPledgeRow) });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/recurring-donations/:id ───────────────────────────────────────

/**
 * Cancel a recurring donation pledge.
 *
 * @route DELETE /api/recurring-donations/:id
 * @param {string} id  UUID of the pledge to cancel
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ success: false, error: "Invalid pledge ID" });
    }

    const result = await pool.query(
      `UPDATE recurring_donations
       SET status = 'cancelled'
       WHERE id = $1 AND status NOT IN ('completed', 'cancelled')
       RETURNING *`,
      [id]
    );

    if (!result.rows[0]) {
      // Either not found or already terminal
      const existing = await pool.query(
        "SELECT id, status FROM recurring_donations WHERE id = $1",
        [id]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ success: false, error: "Pledge not found" });
      }
      return res.status(409).json({
        success: false,
        error: `Pledge is already ${existing.rows[0].status}`,
      });
    }

    logger.info(
      { event: "recurring_donation_cancelled", pledgeId: id },
      "[recurringDonations] Pledge cancelled"
    );

    return res.json({ success: true, data: mapPledgeRow(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ── Row mapper ────────────────────────────────────────────────────────────────

/**
 * Map a recurring_donations DB row to a camelCase API response object.
 *
 * @param {object} row
 * @returns {object}
 */
function mapPledgeRow(row) {
  return {
    id:              row.id,
    donorAddress:    row.donor_address,
    projectId:       row.project_id,
    projectName:     row.project_name ?? undefined,
    amountXlm:       parseFloat(row.amount_xlm),
    currency:        row.currency,
    nextDueDate:     row.next_due_date instanceof Date
      ? row.next_due_date.toISOString().slice(0, 10)
      : String(row.next_due_date).slice(0, 10),
    durationMonths:  row.duration_months,
    remainingMonths: row.remaining_months,
    status:          row.status,
    createdAt:       row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at,
  };
}

module.exports = router;
