"use strict";

const client = require("prom-client");
const pool = require("../db/pool");

const register = client.register;
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled by the API.",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

const httpErrorsTotal = new client.Counter({
  name: "http_errors_total",
  help: "Total HTTP 5xx error responses.",
  labelNames: ["method", "route"],
  registers: [register],
});

const donationsTotal = new client.Counter({
  name: "greenpay_donations_total",
  help: "Total recorded donations (count).",
  labelNames: ["currency"],
  registers: [register],
});

const donationAmountXlmTotal = new client.Counter({
  name: "greenpay_donation_amount_xlm_total",
  help: "Cumulative XLM donated.",
  registers: [register],
});

const queueDepthGauge = new client.Gauge({
  name: "greenpay_queue_depth",
  help: "Number of pg-boss jobs currently pending or active per queue.",
  labelNames: ["name", "state"],
  registers: [register],
});

const failedJobsGauge = new client.Gauge({
  name: "greenpay_failed_jobs",
  help: "Number of failed pg-boss jobs.",
  registers: [register],
});

let statsRefreshFailuresTotal = register.getSingleMetric("stats_refresh_failures_total");
if (!statsRefreshFailuresTotal) {
  statsRefreshFailuresTotal = new client.Counter({
    name: "stats_refresh_failures_total",
    help: "Total number of stats refresh job failures in pg-boss statsRefreshQueue",
    labelNames: ["queue", "reason"],
    registers: [register],
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
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });
}

async function refreshQueueDepth() {
  try {
    const result = await pool.query(`
      SELECT name, state, COUNT(*)::int AS count
      FROM pgboss.job
      WHERE state IN ('created', 'retry', 'active')
      GROUP BY name, state
    `);
    queueDepthGauge.reset();
    for (const row of result.rows) {
      queueDepthGauge.set({ name: row.name, state: row.state }, row.count);
    }

    const failed = await pool.query(
      "SELECT COALESCE(COUNT(*), 0)::int AS count FROM pgboss.job WHERE state = 'failed'"
    );
    failedJobsGauge.set(Number(failed.rows[0].count || 0));
  } catch (err) {
    void err;
  }
}

let refreshInterval = null;
function startQueueRefresh(intervalMs = 15000) {
  if (refreshInterval) return;
  void refreshQueueDepth();
  refreshInterval = setInterval(() => {
    void refreshQueueDepth();
  }, intervalMs);
  if (refreshInterval.unref) refreshInterval.unref();
}

function countRequest(req, res) {
  const route = req.route?.path || req.path || "unknown";
  httpRequestsTotal.inc({
    method: req.method,
    route,
    status_code: String(res.statusCode),
  });
  if (res.statusCode >= 500) {
    httpErrorsTotal.inc({ method: req.method, route });
  }
}

function countDonation(currency = "XLM", xlmAmount = 0) {
  donationsTotal.inc({ currency: (currency || "XLM").toUpperCase() });
  const amt = Number.parseFloat(xlmAmount);
  if (Number.isFinite(amt) && amt > 0) {
    donationAmountXlmTotal.inc(amt);
  }
}

async function metricsHandler(req, res) {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  client,
  register,
  metricsHandler,
  countRequest,
  countDonation,
  startQueueRefresh,
  httpRequestsTotal,
  httpErrorsTotal,
  donationsTotal,
  donationAmountXlmTotal,
  queueDepthGauge,
  failedJobsGauge,
  statsRefreshFailuresTotal,
  leaderboardQueryDuration,
};
