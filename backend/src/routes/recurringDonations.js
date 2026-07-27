"use strict";
const express = require("express");
const router  = express.Router();
const pool = require("../db/pool");

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

router.get("/", async (req, res, next) => {
  try {
    const donorAddress = req.query.donorAddress;
    if (!donorAddress) {
      return res.json({ success: true, data: [] });
    }
    validateKey(donorAddress);

    const result = await pool.query(
      `SELECT rd.*, p.name AS project_name
       FROM recurring_donations rd
       JOIN projects p ON rd.project_id = p.id
       WHERE rd.donor_address = $1
       ORDER BY rd.created_at DESC`,
      [donorAddress],
    );

    const data = result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      amountXLM: row.amount_xlm.toString(),
      durationMonths: row.duration_months,
      remainingMonths: row.remaining_months,
      status: row.status,
      startDate: row.start_date,
      nextDueDate: row.next_due_date,
      createdAt: row.created_at,
    }));

    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

module.exports = router;