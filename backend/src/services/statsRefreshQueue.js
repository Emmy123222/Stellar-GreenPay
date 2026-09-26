/**
 * pg-boss job: refresh global_stats_mv every 60 seconds.
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const { Sentry } = require("./sentry");
const { statsRefreshFailuresTotal } = require("./metrics");

const QUEUE = "refresh-global-stats-mv";
const CRON = "* * * * *"; // every 60 seconds

let boss = null;

async function refreshGlobalStatsMv() {
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY global_stats_mv");
  console.log("[statsRefreshQueue] refreshed global_stats_mv");
}

/**
 * Record a failed/expired job in the dead_letter table.
 *
 * @param {object} job - pg-boss job object or completion payload
 * @param {string} [errorMessage] - Optional explicit error message
 */
async function moveToDeadLetter(job, errorMessage) {
  const jobId = job?.data?.request?.id || job?.id || null;
  const payload = job?.data?.request?.data || job?.data || {};
  const error =
    errorMessage ||
    job?.data?.response?.message ||
    (typeof job?.data?.response === "string" ? job.data.response : null) ||
    job?.error?.message ||
    job?.error ||
    "Stats refresh job failed after exhausting retries";

  try {
    await pool.query(
      `INSERT INTO dead_letter (queue_name, job_id, payload, error, failed_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [QUEUE, jobId, JSON.stringify(payload), String(error)]
    );
  } catch (err) {
    console.error("[statsRefreshQueue] failed to write to dead_letter table:", err.message);
  }
}

/**
 * Handle failed or expired jobs:
 * 1. Log failed job to Sentry with context metadata
 * 2. Move failed job to dead_letter table and pg-boss archive
 * 3. Increment Prometheus counter stats_refresh_failures_total
 *
 * @param {object} job - pg-boss job object or completion payload
 */
async function onExpire(job) {
  if (!job) return;

  const errorMessage =
    job.data?.response?.message ||
    (typeof job.data?.response === "string" ? job.data.response : null) ||
    job.error?.message ||
    job.error ||
    "Stats refresh job expired or failed";

  const errorObj =
    job.error instanceof Error
      ? job.error
      : new Error(errorMessage);

  const jobId = job.data?.request?.id || job.id;
  const state = job.data?.state || job.state || "expired";
  const retryCount = job.data?.retryCount ?? job.retrycount ?? null;

  // 1. Log to Sentry
  try {
    if (Sentry && typeof Sentry.captureException === "function") {
      Sentry.captureException(errorObj, {
        tags: {
          queue: QUEUE,
          service: "statsRefreshQueue",
          state,
        },
        extra: {
          jobId,
          queue: QUEUE,
          state,
          retryCount,
          payload: job.data?.request?.data || job.data,
        },
      });
    }
  } catch (sentryErr) {
    console.error("[statsRefreshQueue] Failed to report to Sentry:", sentryErr.message);
  }

  // 2. Move to dead_letter table
  await moveToDeadLetter(job, errorMessage);

  // 3. Move to pg-boss archive if available
  if (boss && typeof boss.archive === "function") {
    try {
      await boss.archive();
    } catch (archiveErr) {
      console.error("[statsRefreshQueue] pg-boss archive error:", archiveErr.message);
    }
  }

  // 4. Increment Prometheus counter
  try {
    if (statsRefreshFailuresTotal && typeof statsRefreshFailuresTotal.inc === "function") {
      statsRefreshFailuresTotal.inc({ queue: QUEUE, reason: state });
    }
  } catch (metricErr) {
    console.error("[statsRefreshQueue] metric increment error:", metricErr.message);
  }
}

async function start() {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("[statsRefreshQueue] pg-boss error:", err.message));

  await boss.start();

  // Schedule with retry and onComplete tracking
  await boss.schedule(
    QUEUE,
    CRON,
    {},
    {
      tz: "UTC",
      retryLimit: 3,
      retryDelay: 10,
      retryBackoff: true,
      onComplete: true,
    }
  );

  // Register the onExpire / onComplete handler
  if (typeof boss.onExpire === "function") {
    await boss.onExpire(QUEUE, onExpire);
  } else if (typeof boss.onComplete === "function") {
    await boss.onComplete(QUEUE, onExpire);
  }

  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    try {
      await refreshGlobalStatsMv();
    } catch (err) {
      if (statsRefreshFailuresTotal && typeof statsRefreshFailuresTotal.inc === "function") {
        statsRefreshFailuresTotal.inc({ queue: QUEUE, reason: err.message || "refresh_failed" });
      }
      throw err;
    }
  });

  // Warm the view once at startup (non-concurrent is fine if empty/first run)
  try {
    await pool.query("REFRESH MATERIALIZED VIEW global_stats_mv");
  } catch (err) {
    console.error("[statsRefreshQueue] initial refresh failed:", err.message);
  }

  console.log("[statsRefreshQueue] scheduled every 60s on queue:", QUEUE);
}

module.exports = {
  start,
  refreshGlobalStatsMv,
  onExpire,
  moveToDeadLetter,
  QUEUE,
  CRON,
  getBoss: () => boss,
};
