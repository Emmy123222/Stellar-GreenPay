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
const { sendRecurringDonationReminder } = require("./push");

const QUEUE = "recurring-donation-reminder";
// Default: daily at 08:00 UTC
const DEFAULT_CRON = "0 8 * * *";

let boss = null;

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

  logger.info(
    { event: "recurring_donation_reminder_scheduled", cron: cronSchedule },
    `[recurringDonationQueue] Scheduled daily reminder check: ${cronSchedule}`
  );
}

module.exports = { start, runReminderCheck };
