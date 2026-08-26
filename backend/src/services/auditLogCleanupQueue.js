/**
 * src/services/auditLogCleanupQueue.js
 *
 * Daily cron job that archives or deletes audit log records older than a
 * configurable retention window (default: 1 year / 365 days).
 *
 * Uses pg-boss for scheduling. Supports both deletion and archival:
 * - AUDIT_LOG_RETENTION_DAYS: How many days to retain (default 365)
 * - AUDIT_LOG_ARCHIVE_ENABLED: If true, exports old records to a table before deleting
 * - AUDIT_LOG_CLEANUP_CRON: Cron schedule (default daily at 02:00 UTC)
 * - AUDIT_LOG_CLEANUP_CRON="disabled" to turn off entirely
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");

const QUEUE = "audit-log-cleanup";
// Default: daily at 02:00 UTC (low-traffic time)
const DEFAULT_CRON = "0 2 * * *";

// Configuration from environment
const RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || "365", 10);
const ARCHIVE_ENABLED = process.env.AUDIT_LOG_ARCHIVE_ENABLED === "true";

let boss = null;

/**
 * Run the audit log cleanup job.
 * Deletes or archives records older than RETENTION_DAYS.
 */
async function runCleanup() {
  logger.info(
    { event: "audit_log_cleanup_start", retention_days: RETENTION_DAYS },
    "[auditLogCleanup] Starting audit log cleanup"
  );

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    if (ARCHIVE_ENABLED) {
      await archiveOldRecords(cutoffDate);
    }

    const result = await deleteOldRecords(cutoffDate);

    logger.info(
      {
        event: "audit_log_cleanup_complete",
        deleted_count: result.rowCount,
        cutoff_date: cutoffDate.toISOString(),
      },
      `[auditLogCleanup] Deleted ${result.rowCount} audit log records older than ${cutoffDate.toISOString()}`
    );
  } catch (err) {
    logger.error(
      { event: "audit_log_cleanup_error", err },
      `[auditLogCleanup] Cleanup failed: ${err.message}`
    );
    throw err;
  }
}

/**
 * Archive old audit log records to an archive table before deletion.
 * This preserves historical data in a separate table for long-term storage.
 */
async function archiveOldRecords(cutoffDate) {
  logger.debug(
    { event: "audit_log_archive_start", cutoff_date: cutoffDate.toISOString() },
    "[auditLogCleanup] Archiving records"
  );

  try {
    // Ensure archive table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log_archive (
        LIKE admin_audit_log INCLUDING ALL
      )
    `);

    // Move old records to archive table
    const result = await pool.query(
      `INSERT INTO admin_audit_log_archive
       SELECT * FROM admin_audit_log WHERE created_at < $1
       ON CONFLICT DO NOTHING`,
      [cutoffDate]
    );

    logger.info(
      { event: "audit_log_archive_complete", archived_count: result.rowCount },
      `[auditLogCleanup] Archived ${result.rowCount} records`
    );
  } catch (err) {
    logger.error(
      { event: "audit_log_archive_error", err },
      `[auditLogCleanup] Archive failed: ${err.message}`
    );
    // Don't throw — allow cleanup to continue even if archival fails
    // The records will be deleted on the next run
  }
}

/**
 * Delete audit log records older than the cutoff date.
 */
async function deleteOldRecords(cutoffDate) {
  return pool.query(
    `DELETE FROM admin_audit_log WHERE created_at < $1`,
    [cutoffDate]
  );
}

/**
 * Start the audit log cleanup scheduler.
 * Registers a pg-boss cron job and a worker that processes it.
 * Safe to call multiple times (guards with module-level `boss`).
 */
async function start() {
  const cronOverride = process.env.AUDIT_LOG_CLEANUP_CRON;
  if (cronOverride === "disabled") {
    logger.info(
      { event: "audit_log_cleanup_disabled" },
      "[auditLogCleanup] Disabled via AUDIT_LOG_CLEANUP_CRON env"
    );
    return;
  }

  const cronSchedule = cronOverride || DEFAULT_CRON;
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) =>
    logger.error({ event: "audit_log_cleanup_pgboss_error", err }, err.message)
  );

  await boss.start();

  // Register the cron schedule (idempotent — pg-boss deduplicates by name)
  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });

  // Register the worker
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runCleanup();
  });

  logger.info(
    {
      event: "audit_log_cleanup_scheduled",
      cron: cronSchedule,
      retention_days: RETENTION_DAYS,
      archive_enabled: ARCHIVE_ENABLED,
    },
    `[auditLogCleanup] Scheduled daily cleanup: ${cronSchedule} (retention: ${RETENTION_DAYS} days)`
  );
}

module.exports = {
  start,
  runCleanup,
  archiveOldRecords,
  deleteOldRecords,
};
