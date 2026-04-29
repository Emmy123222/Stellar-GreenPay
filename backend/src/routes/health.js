/**
 * src/routes/health.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const indexerService = require("../services/indexerService");

router.get("/", (req, res) => res.json({ 
  status: "ok", 
  service: "stellar-greenpay-api", 
  network: process.env.STELLAR_NETWORK || "testnet", 
  timestamp: new Date().toISOString(),
  indexer: indexerService.getStatus()
}));
module.exports = router;
