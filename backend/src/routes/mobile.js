"use strict";

/**
 * src/routes/mobile.js
 *
 * Mounts the same route handlers under /api/mobile/* for React Native
 * and other non-browser clients that cannot manage cookies / CSRF tokens.
 *
 * Authentication is handled by the shared auth middleware (Bearer JWT or
 * Stellar wallet-signature).  CSRF is intentionally skipped for this
 * prefix — see src/middleware/selectiveCsrf.js.
 *
 * Route map
 * ---------
 *  /api/mobile/donations  → donations router
 *  /api/mobile/projects   → projects router
 *  /api/mobile/profiles   → profiles router
 *  /api/mobile/ratings    → ratings router
 *  /api/mobile/impact     → impact router
 *  /api/mobile/leaderboard → leaderboard router
 */

const express = require("express");
const router = express.Router();

router.use("/donations", require("./donations"));
router.use("/projects", require("./projects"));
router.use("/profiles", require("./profiles"));
router.use("/ratings", require("./ratings"));
router.use("/impact", require("./impact"));
router.use("/leaderboard", require("./leaderboard"));

module.exports = router;
