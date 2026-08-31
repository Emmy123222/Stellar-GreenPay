/**
 * src/routes/health.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const indexerService = require("../services/indexerService");

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ||
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

function getMaxFailedJobs() {
  const parsed = Number.parseInt(process.env.PGBOSS_MAX_FAILED_JOBS ?? "10", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
}

router.get("/", async (req, res) => {
  let dbStatus = "ok";
  let failedJobs = null;
  let pgbossStatus = "ok";
  const maxFailedJobs = getMaxFailedJobs();

  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "unreachable";
  }

  if (dbStatus === "ok") {
    try {
      const result = await pool.query(
        "SELECT COUNT(*)::int AS count FROM pgboss.job WHERE state = $1",
        ["failed"]
      );
      failedJobs = result.rows[0].count;
      if (failedJobs > maxFailedJobs) {
        pgbossStatus = "alert";
      }
    } catch {
      pgbossStatus = "unreachable";
    }
  } else {
    pgbossStatus = "unreachable";
  }

  const status = dbStatus === "ok" && pgbossStatus === "ok" ? "ok" : "degraded";
  const httpStatus = status === "ok" ? 200 : 503;

  res.status(httpStatus).json({
    status,
    service: "stellar-greenpay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    timestamp: new Date().toISOString(),
    checks: {
      db: dbStatus,
      pgboss: {
        status: pgbossStatus,
        failedJobs,
        maxFailedJobs,
      },
    },
    indexer: indexerService.getStatus(),
  });
});

module.exports = router;
