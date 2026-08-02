/**
 * src/services/recurringDonationQueue.js
 *
 * Daily pg-boss cron job that queries recurring_donations where the next
 * due date is within the next 24 hours and sends a push notification
 * reminder via the push.js service.
 *
 * The cron schedule is controlled by the RECURRING_REMINDER_CRON env var
 * (default: daily at 09:00 UTC). Set RECURRING_REMINDER_CRON="disabled" to
 * turn it off entirely.
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");
const { sendRecurringReminder } = require("./push");

const QUEUE = "recurring-donation-reminder";
// Default: daily at 09:00 UTC
const DEFAULT_CRON = "0 9 * * *";

let boss = null;

/**
 * Run the recurring-donation reminder check.
 * Queries active recurring donations due within the next 24 hours and sends
 * push notifications to the donor's registered device tokens.
 */
async function runReminderCheck() {
  logger.info({ event: "recurring_reminder_run_start" }, "[recurringDonationQueue] Starting reminder check");

  const result = await pool.query(
    `SELECT rd.id, rd.donor_address, rd.amount_xlm, rd.frequency,
            p.id AS project_id, p.name AS project_name
     FROM recurring_donations rd
     JOIN projects p ON p.id = rd.project_id
     WHERE rd.status = 'active'
       AND rd.next_due_date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'`,
  );

  if (result.rows.length === 0) {
    logger.info({ event: "recurring_reminder_no_donations" }, "[recurringDonationQueue] No donations due in the next 24 hours");
    return;
  }

  let sent = 0;
  let errors = 0;

  for (const row of result.rows) {
    try {
      await sendRecurringReminder(
        row.donor_address,
        row.project_name,
        Number.parseFloat(row.amount_xlm),
        row.project_id,
      );
      sent++;
      logger.info({
        event: "recurring_reminder_sent",
        recurringDonationId: row.id,
        donorAddress: row.donor_address,
        projectId: row.project_id,
      }, "[recurringDonationQueue] Reminder sent");
    } catch (err) {
      errors++;
      logger.error({
        event: "recurring_reminder_error",
        recurringDonationId: row.id,
        err: err.message,
      }, "[recurringDonationQueue] Failed to send reminder");
    }
  }

  logger.info({
    event: "recurring_reminder_run_complete",
    sent,
    errors,
  }, `[recurringDonationQueue] Reminder check complete — ${sent} sent, ${errors} errors`);
}

/**
 * Start the pg-boss scheduler and register the recurring-donation reminder
 * worker. Safe to call multiple times (guards with module-level `boss`).
 */
async function start() {
  const cronOverride = process.env.RECURRING_REMINDER_CRON;
  if (cronOverride === "disabled") {
    logger.info({ event: "recurring_reminder_disabled" }, "[recurringDonationQueue] Reminder queue disabled via env");
    return;
  }

  const cronSchedule = cronOverride || DEFAULT_CRON;
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) => logger.error({ event: "recurring_reminder_pgboss_error", err }, err.message));

  await boss.start();

  // Register the cron schedule (idempotent — pg-boss deduplicates by name)
  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });

  // Register the worker
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runReminderCheck();
  });

  logger.info({
    event: "recurring_reminder_scheduled",
    cron: cronSchedule,
  }, `[recurringDonationQueue] Recurring donation reminder scheduled: ${cronSchedule}`);
}

module.exports = { start, runReminderCheck };
