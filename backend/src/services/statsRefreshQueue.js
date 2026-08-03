/**
 * pg-boss job: refresh global_stats_mv every 60 seconds.
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");

const QUEUE = "refresh-global-stats-mv";
const CRON = "* * * * *"; // every 60 seconds

let boss = null;

async function refreshGlobalStatsMv() {
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY global_stats_mv");
  console.log("[statsRefreshQueue] refreshed global_stats_mv");
}

async function start() {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("[statsRefreshQueue] pg-boss error:", err.message));

  await boss.start();
  await boss.schedule(QUEUE, CRON, {}, { tz: "UTC" });
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await refreshGlobalStatsMv();
  });

  // Warm the view once at startup (non-concurrent is fine if empty/first run)
  try {
    await pool.query("REFRESH MATERIALIZED VIEW global_stats_mv");
  } catch (err) {
    console.error("[statsRefreshQueue] initial refresh failed:", err.message);
  }

  console.log("[statsRefreshQueue] scheduled every 60s on queue:", QUEUE);
}

module.exports = { start, refreshGlobalStatsMv };
