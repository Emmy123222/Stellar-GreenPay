/**
 * src/routes/updates.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { updates } = require("../services/store");
const { createRateLimiter } = require("../middleware/rateLimiter")

const updatesLimiter = createRateLimiter(100, 1);

router.get("/:projectId", updatesLimiter,(req, res) => {
  const result = Array.from(updates.values())
    .filter(u => u.projectId === req.params.projectId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, data: result });
});

module.exports = router;
