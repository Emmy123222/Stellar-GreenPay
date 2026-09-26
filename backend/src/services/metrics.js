/**
 * src/services/metrics.js
 * Prometheus instrumentation. See issue #1093.
 */
"use strict";

const client = require("prom-client");

// A dedicated registry rather than the prom-client default: it keeps the
// exposition surface limited to the metrics this app actually defines, and
// avoids the background collector interval that `collectDefaultMetrics()`
// starts (which would otherwise outlive every Jest worker).
const register = new client.Registry();

/**
 * Duration of the leaderboard aggregate query — the `GROUP BY` over
 * `profiles JOIN donations` that made the endpoint expensive enough to need a
 * cache. Observed only when the query actually reaches Postgres, so the
 * histogram answers "how slow is the database?" and stays honest even when the
 * cache is doing its job.
 */
const leaderboardQueryDuration = new client.Histogram({
  name: "greenpay_leaderboard_query_duration_seconds",
  help: "Wall-clock duration of the leaderboard aggregate query executed against Postgres (cache misses only).",
  labelNames: ["period", "sort_by"],
  // Query times span sub-millisecond cached-shaped reads to multi-second full
  // scans, so the buckets cover three orders of magnitude.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * Express handler exposing the registry in Prometheus text format.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
async function metricsHandler(req, res) {
  void req;
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  register,
  leaderboardQueryDuration,
  metricsHandler,
};
