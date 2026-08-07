/**
 * src/routes/jobs.js — Escrow job metadata (on-chain release is separate).
 */
"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const redis = require("../services/redis");
const { mapJobRow } = require("../services/store");

const JOBS_STATS_CACHE_KEY = "jobs:stats";
const JOBS_STATS_CACHE_TTL_SECONDS = 60;

function validateTxHash(h) {
  if (!h || !/^[a-fA-F0-9]{64}$/.test(h)) {
    const e = new Error("Invalid transaction hash");
    e.status = 400;
    throw e;
  }
}

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) {
    const e = new Error("Invalid Stellar public key");
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

    const { limit = 50, cursor } = req.query;
    const maxLimit = Math.min(limit, 100);
    
    if (cursor) {
      const cursorDate = new Date(parseInt(cursor));
      conditions.push(`created_at < $${paramIndex}`);
      values.push(cursorDate);
      paramIndex++;
    }
    
    queryStr += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    values.push(maxLimit);
    paramIndex++;

    // eslint-disable-next-line sql-injection/no-sql-injection
    const result = await pool.query(queryStr, values);
    res.json({ success: true, data: result.rows.map(mapJobRow) });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { title, description, clientPublicKey, freelancerPublicKey, amountEscrowXlm } = req.body;

    if (!title || !title.trim()) {
      const e = new Error("title is required");
      e.status = 400;
      throw e;
    }

    if (!description || !description.trim()) {
      const e = new Error("description is required");
      e.status = 400;
      throw e;
    }

    validateKey(clientPublicKey);
    validateKey(freelancerPublicKey);

    const amount = parseFloat(amountEscrowXlm);
    if (isNaN(amount) || amount <= 0) {
      const e = new Error("amountEscrowXlm must be a positive number");
      e.status = 400;
      throw e;
    }

    const result = await pool.query(
      `INSERT INTO jobs (id, title, description, client_public_key, freelancer_public_key, amount_escrow_xlm, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [uuid(), title.trim(), description.trim(), clientPublicKey, freelancerPublicKey, amount, "in_escrow"],
    );

    res.status(201).json({ success: true, data: mapJobRow(result.rows[0]) });
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

// GET /api/jobs/stats — aggregated escrow marketplace metrics
router.get("/stats", async (req, res, next) => {
  try {
    const cached = await redis.get(JOBS_STATS_CACHE_KEY);
    if (cached) {
      return res.json(cached);
    }

    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'in_escrow')::int AS "totalJobsInEscrow",
        COUNT(*) FILTER (WHERE status = 'completed')::int  AS "totalJobsCompleted",
        COALESCE(SUM(amount_escrow_xlm) FILTER (WHERE status = 'in_escrow'), 0)::text AS "totalEscrowXLM",
        COALESCE(SUM(amount_escrow_xlm) FILTER (WHERE status = 'completed'), 0)::text  AS "totalReleasedXLM"
      FROM jobs
    `);

    const row = result.rows[0];
    const stats = {
      totalJobsInEscrow: Number.parseInt(row.totalJobsInEscrow, 10) || 0,
      totalJobsCompleted: Number.parseInt(row.totalJobsCompleted, 10) || 0,
      totalEscrowXLM: Number.parseFloat(row.totalEscrowXLM || "0").toFixed(7),
      totalReleasedXLM: Number.parseFloat(row.totalReleasedXLM || "0").toFixed(7),
    };

    await redis.set(JOBS_STATS_CACHE_KEY, stats, JOBS_STATS_CACHE_TTL_SECONDS);

    res.json(stats);
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
module.exports.JOBS_STATS_CACHE_KEY = JOBS_STATS_CACHE_KEY;
module.exports.JOBS_STATS_CACHE_TTL_SECONDS = JOBS_STATS_CACHE_TTL_SECONDS;
