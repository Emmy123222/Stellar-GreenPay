/**
 * src/routes/readiness.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ||
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

router.get("/", async (req, res) => {
  let dbStatus = "ok";
  let horizonStatus = "ok";

  await Promise.all([
    pool.query("SELECT 1").catch(() => { dbStatus = "unreachable"; }),
    fetch(`${HORIZON_URL}/fee_stats`, { signal: AbortSignal.timeout(4000) })
      .then((r) => { if (!r.ok) horizonStatus = "unreachable"; })
      .catch(() => { horizonStatus = "unreachable"; }),
  ]);

  const healthy = dbStatus === "ok" && horizonStatus === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ready" : "not ready",
    timestamp: new Date().toISOString(),
    checks: { db: dbStatus, horizon: horizonStatus },
  });
});

module.exports = router;
