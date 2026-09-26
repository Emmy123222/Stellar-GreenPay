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

module.exports = {
  client,
  register,
  statsRefreshFailuresTotal,
};
