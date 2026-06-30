/**
 * src/routes/jobs.js — Escrow job metadata (on-chain release is separate).
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { mapJobRow } = require("../services/store");

function validateTxHash(h) {
  if (!h || !/^[a-fA-F0-9]{64}$/.test(h)) {
    const e = new Error("Invalid transaction hash");
    e.status = 400;
    throw e;
  }
}

router.get("/", async (req, res, next) => {
  try {
    const { status, clientPublicKey } = req.query;
    let queryStr = "SELECT * FROM jobs";
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = ANY($${paramIndex})`);
      values.push(status.split("|"));
      paramIndex++;
    }

    if (clientPublicKey) {
      conditions.push(`client_public_key = $${paramIndex}`);
      values.push(clientPublicKey);
      paramIndex++;
    }

    if (conditions.length > 0) {
      queryStr += " WHERE " + conditions.join(" AND ");
    }

    queryStr += " ORDER BY created_at DESC LIMIT 50";

    const result = await pool.query(queryStr, values);
    res.json({ success: true, data: result.rows.map(mapJobRow) });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/release", async (req, res, next) => {
  try {
    const { releaseTransactionHash } = req.body;
    validateTxHash(releaseTransactionHash);

    const found = await pool.query("SELECT * FROM jobs WHERE id = $1", [
      req.params.id,
    ]);
    if (!found.rows[0]) {
      const e = new Error("Job not found");
      e.status = 404;
      throw e;
    }
    if (found.rows[0].status !== "in_escrow") {
      const e = new Error("Job is not awaiting release");
      e.status = 400;
      throw e;
    }

    const updated = await pool.query(
      `UPDATE jobs
       SET status = 'completed',
           release_transaction_hash = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [releaseTransactionHash, req.params.id],
    );

    res.json({ success: true, data: mapJobRow(updated.rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM jobs WHERE id = $1", [
      req.params.id,
    ]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json({ success: true, data: mapJobRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
