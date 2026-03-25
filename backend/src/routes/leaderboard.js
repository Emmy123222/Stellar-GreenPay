/**
 * src/routes/leaderboard.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { profiles } = require("../services/store");
const { createRateLimiter } = require("../middleware/rateLimiter")

const leaderboardLimiter = createRateLimiter(50, 1);

router.get("/", leaderboardLimiter ,(req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const entries = Array.from(profiles.values())
    .sort((a, b) => parseFloat(b.totalDonatedXLM) - parseFloat(a.totalDonatedXLM))
    .slice(0, limit)
    .map((p, i) => ({
      rank:              i + 1,
      publicKey:         p.publicKey,
      displayName:       p.displayName || null,
      totalDonatedXLM:   p.totalDonatedXLM,
      projectsSupported: p.projectsSupported,
      topBadge:          p.badges?.[0]?.tier || null,
    }));
  res.json({ success: true, data: entries });
});

module.exports = router;
