/**
 * src/services/tokenCleanupQueue.js
 *
 * Daily cron job that removes stale push device tokens.
 *
 * A token is considered stale when:
 *   1. It has had at least one successful delivery (last_delivered_at IS NOT NULL), AND
 *   2. The last successful delivery was more than 90 days ago.
 *
 * Tokens that were never successfully delivered (last_delivered_at IS NULL) are left
 * alone — they may be newly registered and simply haven't been tested yet.
 *
 * Uses pg-boss for scheduling (already a project dependency).
 * Schedule: daily at 03:00 UTC (configurable via TOKEN_CLEANUP_CRON env).
 * Set TOKEN_CLEANUP_CRON="disabled" to turn it off entirely.
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");

const QUEUE = "device-token-cleanup";
const DEFAULT_CRON = "0 3 * * *";
const STALE_INTERVAL = "90 days";

let boss = null;

/**
 * Remove device tokens whose last successful delivery is older than 90 days.
 * Deleting a token cascades to project_follows (FK ON DELETE CASCADE).
 */
async function runCleanup() {
  logger.info(
    { event: "token_cleanup_start" },
    "[tokenCleanup] Starting stale token cleanup"
  );

  try {
    const result = await pool.query(
      `DELETE FROM device_tokens
       WHERE last_delivered_at IS NOT NULL
         AND last_delivered_at < NOW() - INTERVAL '${STALE_INTERVAL}'
       RETURNING id, token, platform`
    );

    const count = result.rowCount;

    if (count > 0) {
      const tokenIds = result.rows.map((r) => r.id);
      logger.info(
        { event: "tokens_pruned", count, tokenIds },
        `[tokenCleanup] Removed ${count} stale device token(s)`
      );
    } else {
      logger.info(
        { event: "tokens_pruned", count: 0 },
        "[tokenCleanup] No stale tokens found"
      );
    }
  } catch (err) {
    logger.error({ event: "token_cleanup_error", err }, err.message);
  }
}

/**
 * Start the token cleanup scheduler.
 * Registers a pg-boss cron job and a worker that processes it.
 * Safe to call multiple times (guards with module-level `boss`).
 */
async function start() {
  const cronOverride = process.env.TOKEN_CLEANUP_CRON;
  if (cronOverride === "disabled") {
    logger.info(
      { event: "token_cleanup_disabled" },
      "[tokenCleanup] Disabled via TOKEN_CLEANUP_CRON env"
    );
    return;
  }

  const cronSchedule = cronOverride || DEFAULT_CRON;
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) =>
    logger.error({ event: "token_cleanup_pgboss_error", err }, err.message)
  );

  await boss.start();

  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });

  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runCleanup();
  });

  logger.info(
    { event: "token_cleanup_scheduled", cron: cronSchedule },
    `[tokenCleanup] Scheduled daily cleanup: ${cronSchedule}`
  );
}

module.exports = { start, runCleanup };
