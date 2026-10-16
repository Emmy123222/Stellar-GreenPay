/**
 * src/routes/health.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const redis = require("../services/redis");
const indexerService = require("../services/indexerService");

const HEALTH_CHECK_TIMEOUT_MS = 3000;

async function isReachable(check) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(check).then(() => true, () => false),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function getMaxFailedJobs() {
  const parsed = Number.parseInt(process.env.PGBOSS_MAX_FAILED_JOBS ?? "10", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
}

router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const [dbReachable, redisReachable] = await Promise.all([
    isReachable(() => pool.query("SELECT 1")),
    isReachable(() => redis.ping()),
  ]);
  const dbStatus = dbReachable ? "ok" : "unreachable";
  const redisStatus = redisReachable ? "ok" : "unreachable";
  let failedJobs = null;
  let pgbossStatus = dbReachable ? "ok" : "unreachable";
  const maxFailedJobs = getMaxFailedJobs();

  if (dbReachable) {
    const querySucceeded = await isReachable(async () => {
      const result = await pool.query(
        "SELECT COUNT(*)::int AS count FROM pgboss.job WHERE state = $1",
        ["failed"],
      );
      failedJobs = result.rows[0].count;
    });
    if (!querySucceeded) {
      pgbossStatus = "unreachable";
    } else if (failedJobs > maxFailedJobs) {
      pgbossStatus = "alert";
    }
  }

  const status = dbStatus === "ok" && redisStatus === "ok" && pgbossStatus === "ok"
    ? "ok"
    : "degraded";
  const httpStatus = status === "ok" ? 200 : 503;

  res.status(httpStatus).json({
    status,
    service: "stellar-greenpay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    timestamp: new Date().toISOString(),
    checks: {
      db: dbStatus,
      redis: redisStatus,
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
