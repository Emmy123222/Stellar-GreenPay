/**
 * src/services/recurringDonationQueue.js
 *
 * Daily cron job that checks for recurring donations due within the next
 * 24 hours and sends push notification reminders to the donor's device.
 *
 * Uses pg-boss for scheduling (already a project dependency).
 * Schedule: every day at 08:00 UTC (configurable via RECURRING_DONATION_CRON env).
 * Set RECURRING_DONATION_CRON="disabled" to turn it off entirely.
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");
// `./push` is required lazily inside runReminderCheck() so that importing this
// module (e.g. from the routes layer) doesn't eagerly load expo-server-sdk.


const QUEUE = "recurring-donation-reminder";
/**
 * Per-pledge scheduling queue. Every active pledge owns exactly one singleton
 * job keyed by its pledge id, so cancelling a pledge can cancel/delete the
 * job that would otherwise keep firing for a dead pledge.
 */
const PLEDGE_QUEUE = "recurring-donation-pledge";
// Default: daily at 08:00 UTC
const DEFAULT_CRON = "0 8 * * *";

let boss = null;

/**
 * Schedule the singleton pg-boss job that represents an active pledge.
 *
 * The job is keyed by the pledge id (`singletonKey`), so re-scheduling the same
 * pledge is idempotent and the resulting job can be located again at cancel
 * time. Safe to call before the queue has been started — returns `null` and
 * lets the daily reminder cron remain the source of truth.
 *
 * @param {{ pledgeId: string, nextDueDate?: string|Date }} pledge
 * @returns {Promise<string|null>} The pg-boss job id, or null when not started.
 */
async function scheduleRecurringDonationJob({ pledgeId, nextDueDate } = {}) {
  if (!boss || !pledgeId) return null;

  const startAfterSeconds = nextDueDate
    ? Math.max(0, Math.floor((new Date(nextDueDate).getTime() - Date.now()) / 1000))
    : 0;

  return boss.send(
    PLEDGE_QUEUE,
    { pledgeId },
    { singletonKey: pledgeId, startAfter: startAfterSeconds },
  );
}

/**
 * Cancel the pg-boss job belonging to a pledge that is being cancelled.
 *
 * Looks the job up by queue name + `singleton_key` (pg-boss stores the
 * singleton key we passed to `send`) and cancels it so it can no longer fire.
 * Returns `false` when the queue has not been started or no job exists, which
 * callers treat as a no-op.
 *
 * @param {string} pledgeId
 * @returns {Promise<boolean>} Whether a job was found and cancelled.
 */
async function cancelRecurringDonationJob(pledgeId) {
  if (!boss || !pledgeId) return false;

  const { rows } = await pool.query(
    `SELECT id
       FROM pgboss.job
      WHERE name = $1
        AND singleton_key = $2
        AND state IN ('created', 'retry', 'active')
      ORDER BY created_on DESC
      LIMIT 1`,
    [PLEDGE_QUEUE, pledgeId],
  );

  if (rows.length === 0) return false;

  await boss.cancel(PLEDGE_QUEUE, rows[0].id);
  logger.info(
    { event: "recurring_donation_job_cancelled", pledgeId, jobId: rows[0].id },
    "[recurringDonationQueue] Cancelled pg-boss job for pledge"
  );
  return true;
}

/**
 * Run the recurring donation reminder check.
 * Queries all active recurring donations where next_due_date is within
 * the next 24 hours and sends push notifications to the associated device tokens.
 */
async function runReminderCheck() {
  logger.info(
    { event: "recurring_donation_reminder_start" },
    "[recurringDonationQueue] Starting daily reminder check"
  );

  try {
    const result = await pool.query(
      `SELECT rd.id, rd.donor_address, rd.project_id, rd.amount_xlm, rd.frequency,
              rd.next_due_date, dt.token AS device_token, p.name AS project_name
       FROM recurring_donations rd
       JOIN device_tokens dt ON rd.device_token_id = dt.id
       JOIN projects p ON rd.project_id = p.id
       WHERE rd.active = true
         AND rd.next_due_date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'`
    );

    if (result.rows.length === 0) {
      logger.info(
        { event: "recurring_donation_reminder_no_donations" },
        "[recurringDonationQueue] No recurring donations due in the next 24 hours"
      );
      return;
    }

    // eslint-disable-next-line global-require
    const { sendRecurringDonationReminder } = require("./push");

    let sent = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        await sendRecurringDonationReminder({
          token: row.device_token,
          donation: {
            id: row.id,
            project_id: row.project_id,
            project_name: row.project_name,
            amount_xlm: row.amount_xlm,
            frequency: row.frequency,
          },
        });
        sent++;
      } catch (err) {
        errors++;
        logger.error(
          { event: "recurring_donation_reminder_send_error", donationId: row.id, err },
          err.message
        );
      }
    }

    logger.info(
      { event: "recurring_donation_reminder_complete", sent, errors },
      `[recurringDonationQueue] Sent ${sent} reminders (${errors} errors)`
    );
  } catch (err) {
    logger.error(
      { event: "recurring_donation_reminder_query_error", err },
      err.message
    );
  }
}

/**
 * Start the recurring donation reminder scheduler.
 * Registers a pg-boss cron job and a worker that processes it.
 * Safe to call multiple times (guards with module-level `boss`).
 */
async function start() {
  const cronOverride = process.env.RECURRING_DONATION_CRON;
  if (cronOverride === "disabled") {
    logger.info(
      { event: "recurring_donation_reminder_disabled" },
      "[recurringDonationQueue] Disabled via RECURRING_DONATION_CRON env"
    );
    return;
  }

  const cronSchedule = cronOverride || DEFAULT_CRON;
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) =>
    logger.error({ event: "recurring_donation_pgboss_error", err }, err.message)
  );

  await boss.start();

  // Register the cron schedule (idempotent — pg-boss deduplicates by name)
  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });

  // Register the worker
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runReminderCheck();
  });

  // Worker for the per-pledge jobs. These jobs exist so a cancelled pledge can
  // cancel the job that was scheduled against it; the daily cron above still
  // owns reminder delivery.
  await boss.work(PLEDGE_QUEUE, { teamSize: 1, teamConcurrency: 1 }, async ([job]) => {
    const pledgeId = job && job.data && job.data.pledgeId;
    if (!pledgeId) return;

    const { rows } = await pool.query(
      "SELECT id, active FROM recurring_donations WHERE id = $1",
      [pledgeId]
    );
    const pledge = rows[0];
    if (!pledge || !pledge.active) {
      // Pledge was cancelled or deleted between scheduling and firing.
      logger.info(
        { event: "recurring_donation_job_orphaned", pledgeId },
        "[recurringDonationQueue] Skipping job for inactive pledge"
      );
    }
  });

  logger.info(
    { event: "recurring_donation_reminder_scheduled", cron: cronSchedule },
    `[recurringDonationQueue] Scheduled daily reminder check: ${cronSchedule}`
  );
}

module.exports = {
  start,
  runReminderCheck,
  scheduleRecurringDonationJob,
  cancelRecurringDonationJob,
  PLEDGE_QUEUE,
};
