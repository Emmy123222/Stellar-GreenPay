/**
 * src/routes/recurring-donations.js
 * POST /api/recurring-donations — create a recurring donation
 * Enforces a minimum amount of 1 XLM on the server side.
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { z } = require("zod");
const { validateBody } = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimiter");

const MIN_RECURRING_AMOUNT_XLM = 1;

const recurringDonationSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  donorAddress: z.string().min(1, "donorAddress is required"),
  amountXLM: z.union([z.string(), z.number()]).transform((value) => String(value)),
  durationMonths: z.union([z.number(), z.null()]).optional().default(null),
});

const recurringDonationLimiter = createRateLimiter(10, 1);

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

/**
 * Create a recurring donation record.
 *
 * @route POST /api/recurring-donations
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createRecurringDonation(req, res, next) {
  try {
    const { projectId, donorAddress, amountXLM } = req.body;

    validateKey(donorAddress);

    const parsedAmount = parseFloat(amountXLM);
    if (isNaN(parsedAmount) || parsedAmount < MIN_RECURRING_AMOUNT_XLM) {
      const e = new Error(`Minimum recurring donation is ${MIN_RECURRING_AMOUNT_XLM} XLM`);
      e.status = 400;
      throw e;
    }

    res.status(201).json({
      success: true,
      data: {
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        donorAddress,
        amountXLM: parsedAmount.toFixed(7),
        durationMonths: req.body.durationMonths ?? null,
        status: "active",
        createdAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    next(e);
  }
}

router.post("/", recurringDonationLimiter, validateBody(recurringDonationSchema), createRecurringDonation);

module.exports = router;
module.exports.createRecurringDonation = createRecurringDonation;
