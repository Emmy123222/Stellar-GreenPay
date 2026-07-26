/**
 * src/services/recurringDonationQueue.js
 *
 * Processes due recurring donations via pg-boss cron scheduling.
 *
 * Runs daily at 01:00 UTC. For each active recurring donation where
 * next_due_date <= NOW(), logs the intended execution and advances
 * the schedule. Actual on-chain submission is out of scope for this
 * initial implementation — the backend records the pending donation
 * and the mobile/web client is notified to approve the transaction.
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");

const QUEUE = "recurring-donation-process";
const DEFAULT_CRON = "0 1 * * *";

let boss = null;

/**
 * Compute the next due date based on frequency.
 */
function computeNextDueDate(current, frequency) {
  const d = new Date(current);
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "monthly":
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

/**
 * Process all recurring donations that are due.
 */
async function processDueRecurring() {
  logger.info({ event: "recurring_donation_process_start" }, "[recurringDonationQueue] Processing due recurring donations");

  const dueResult = await pool.query(
    `SELECT rd.*, p.name AS project_name
     FROM recurring_donations rd
     JOIN projects p ON rd.project_id = p.id
     WHERE rd.status = 'active'
       AND rd.next_due_date <= NOW()
     ORDER BY rd.next_due_date ASC
     LIMIT 100`
  );

  let processed = 0;
  let errors = 0;

  for (const row of dueResult.rows) {
    try {
      const now = new Date();
      const newRemainingMonths =
        row.remaining_months != null ? row.remaining_months - 1 : null;

      // If duration exhausted, mark as completed
      if (newRemainingMonths !== null && newRemainingMonths <= 0) {
        await pool.query(
          `UPDATE recurring_donations
           SET status = 'completed', updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );
        logger.info({
          event: "recurring_donation_completed",
          id: row.id,
          projectId: row.project_id,
        });
        processed++;
        continue;
      }

      const nextDue = computeNextDueDate(now, row.frequency);

      await pool.query(
        `UPDATE recurring_donations
         SET next_due_date = $1,
             remaining_months = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [nextDue.toISOString(), newRemainingMonths, row.id]
      );

      logger.info({
        event: "recurring_donation_advanced",
        id: row.id,
        projectId: row.project_id,
        walletAddress: row.wallet_address,
        amountXLM: row.amount_xlm,
        nextDueDate: nextDue.toISOString(),
        remainingMonths: newRemainingMonths,
      });

      processed++;
    } catch (err) {
      errors++;
      logger.error(
        { event: "recurring_donation_process_error", id: row.id, err },
        err.message
      );
    }
  }

  logger.info(
    { event: "recurring_donation_process_complete", processed, errors },
    "[recurringDonationQueue] Processing complete"
  );
}

/**
 * Start the recurring donation processor.
 * Registers a pg-boss cron job and worker.
 */
async function start() {
  const cronOverride = process.env.RECURRING_DONATION_CRON;
  if (cronOverride === "disabled") {
    logger.info(
      { event: "recurring_donation_queue_disabled" },
      "[recurringDonationQueue] Disabled via env"
    );
    return;
  }

  const cronSchedule = cronOverride || DEFAULT_CRON;
  const connectionString =
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) =>
    logger.error({ event: "recurring_donation_pgboss_error", err }, err.message)
  );

  await boss.start();
  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await processDueRecurring();
  });

  logger.info(
    { event: "recurring_donation_queue_scheduled", cron: cronSchedule },
    `[recurringDonationQueue] Scheduled: ${cronSchedule}`
  );
}

module.exports = { start, processDueRecurring };
