"use strict";

const client = require("prom-client");

const register = client.register;

let statsRefreshFailuresTotal = register.getSingleMetric("stats_refresh_failures_total");

if (!statsRefreshFailuresTotal) {
  statsRefreshFailuresTotal = new client.Counter({
    name: "stats_refresh_failures_total",
    help: "Total number of stats refresh job failures in pg-boss statsRefreshQueue",
    labelNames: ["queue", "reason"],
  });
}

/**
 * Duration of the leaderboard aggregate query — the `GROUP BY` over
 * `profiles JOIN donations` that made the endpoint expensive enough to need a
 * cache (issue #1093). Observed only when the query actually reaches Postgres,
 * so the histogram answers "how slow is the database?" and stays honest even
 * while the cache is absorbing the traffic.
 */
let leaderboardQueryDuration = register.getSingleMetric(
  "greenpay_leaderboard_query_duration_seconds",
);

if (!leaderboardQueryDuration) {
  leaderboardQueryDuration = new client.Histogram({
    name: "greenpay_leaderboard_query_duration_seconds",
    help: "Wall-clock duration of the leaderboard aggregate query executed against Postgres (cache misses only).",
    labelNames: ["period", "sort_by"],
    // Query times span sub-millisecond cached-shaped reads to multi-second
    // full scans, so the buckets cover three orders of magnitude.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });
}

module.exports = {
  client,
  register,
  statsRefreshFailuresTotal,
  leaderboardQueryDuration,
};
