/**
 * src/routes/recurringDonations.js
 *
 * CRUD endpoints for recurring donation subscriptions.
 */
"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const logger = require("../logger");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { validateBody } = require("../middleware/validation");

const recurringLimiter = createRateLimiter(10, 1);

const createSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  walletAddress: z.string().min(1, "walletAddress is required"),
  amountXLM: z.union([z.string(), z.number()]).transform((v) => String(v)),
  frequency: z.enum(["weekly", "monthly", "quarterly"]).default("monthly"),
  durationMonths: z.number().int().positive().nullable().default(null),
});

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function mapRecurringRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    walletAddress: row.wallet_address,
    amountXLM: row.amount_xlm,
    frequency: row.frequency,
    status: row.status,
    startDate: row.start_date,
    nextDueDate: row.next_due_date,
    lastExecutedAt: row.last_executed_at,
    durationMonths: row.duration_months,
    remainingMonths: row.remaining_months,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeNextDueDate(startDate, frequency) {
  const d = new Date(startDate);
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "monthly":
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d.toISOString();
}

/**
 * Create a recurring donation subscription.
 *
 * @route POST /api/recurring-donations
 */
router.post("/", recurringLimiter, async (req, res, next) => {
  try {
    const { projectId, walletAddress, amountXLM, frequency, durationMonths } =
      createSchema.parse(req.body);

    validateKey(walletAddress);

    const parsedAmount = parseFloat(amountXLM);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      const e = new Error("Invalid amount");
      e.status = 400;
      throw e;
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (!projectResult.rows[0]) {
      const e = new Error("Project not found");
      e.status = 404;
      throw e;
    }

    const now = new Date();
    const nextDueDate = computeNextDueDate(now, frequency);
    const id = uuid();

    const result = await pool.query(
      `INSERT INTO recurring_donations
        (id, project_id, wallet_address, amount_xlm, frequency, status, start_date, next_due_date, duration_months, remaining_months, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [id, projectId, walletAddress, parsedAmount, frequency, now.toISOString(), nextDueDate, durationMonths, durationMonths]
    );

    logger.info({ event: "recurring_donation_created", id, projectId, walletAddress, amountXLM: parsedAmount, frequency });

    res.status(201).json({ success: true, data: mapRecurringRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

/**
 * List recurring donations for a wallet address.
 *
 * @route GET /api/recurring-donations?walletAddress=
 */
router.get("/", async (req, res, next) => {
  try {
    const { walletAddress, status } = req.query;

    if (walletAddress) validateKey(walletAddress);

    let query = "SELECT * FROM recurring_donations WHERE 1=1";
    const params = [];

    if (walletAddress) {
      params.push(walletAddress);
      query += ` AND wallet_address = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += " ORDER BY created_at DESC";

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows.map(mapRecurringRow) });
  } catch (e) {
    next(e);
  }
});

/**
 * Cancel a recurring donation.
 *
 * @route DELETE /api/recurring-donations/:id
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      const e = new Error("Invalid recurring donation ID");
      e.status = 400;
      throw e;
    }

    const result = await pool.query(
      `UPDATE recurring_donations SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [id]
    );

    if (!result.rows[0]) {
      const e = new Error("Recurring donation not found or already cancelled");
      e.status = 404;
      throw e;
    }

    logger.info({ event: "recurring_donation_cancelled", id });

    res.json({ success: true, data: mapRecurringRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
