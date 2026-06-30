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

router.get("/", async (req, res) => {
  let dbStatus = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "unreachable";
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  const httpStatus = dbStatus === "ok" ? 200 : 503;

  res.status(httpStatus).json({
    status,
    service: "stellar-greenpay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    timestamp: new Date().toISOString(),
    checks: { db: dbStatus },
    indexer: indexerService.getStatus(),
  });
});

module.exports = router;
