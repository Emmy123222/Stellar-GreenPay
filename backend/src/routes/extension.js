"use strict";

/**
 * src/routes/extension.js
 *
 * Mounts the same route handlers under /api/extension/* for browser-extension
 * clients (e.g. the Freighter companion extension) whose service-worker context
 * does not share the browser's main-frame cookie jar and therefore cannot
 * obtain or send a CSRF token.
 *
 * CSRF is intentionally skipped for this prefix — see
 * src/middleware/selectiveCsrf.js.
 *
 * Route map
 * ---------
 *  /api/extension/donations   → donations router
 *  /api/extension/projects    → projects router
 *  /api/extension/profiles    → profiles router
 *  /api/extension/ratings     → ratings router
 *  /api/extension/impact      → impact router
 *  /api/extension/leaderboard → leaderboard router
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
