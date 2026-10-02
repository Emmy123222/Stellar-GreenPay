/**
 * src/routes/readiness.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const redis = require("../services/redis");

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(check) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("readiness check timed out")), CHECK_TIMEOUT_MS);

    Promise.resolve()
      .then(check)
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

router.get("/", async (req, res) => {
  const [dbResult, redisResult] = await Promise.all([
    withTimeout(() => pool.query("SELECT 1")),
    withTimeout(() => redis.ping()),
  ].map((check) => check.then(() => "ok", () => "error")));

  const healthy = dbResult === "ok" && redisResult === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: { db: dbResult, redis: redisResult },
  });
});

module.exports = router;
