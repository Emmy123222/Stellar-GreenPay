/**
 * src/services/recurringDonationQueue.js
 *
 * Daily cron job that checks for recurring donations due within the next
 * 24 hours and sends push notification reminders to the donor's device.
 *
 * Also runs a daily deadline check that calls the escrow contract's
 * `check_deadline()` for projects whose funding deadline has passed and
 * whose goal was not met, triggering automatic refunds to donors.
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
/**
 * Deadline check queue. One singleton cron job that finds projects whose
 * funding deadline has passed and calls `check_deadline()` on the escrow
 * contract to trigger refunds when the goal was not met.
 */
const DEADLINE_QUEUE = "donation-goal-deadline";
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
    "[RecurringDonationQueue] Cancelled pg-boss job for pledge"
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
    "[RecurringDonationQueue] Starting daily reminder check"
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
        "[RecurringDonationQueue] No recurring donations due in the next 24 hours"
      );
      return;
    }

    // eslint-disable-next-line global-require
    const { sendRecurringDonationReminder } = require("./push");

    let sent = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        await sendRecurringDonationReminder( {
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
 * Run the daily deadline check.
 *
 * Finds projects whose funding deadline has passed and that have not yet
 * been resolved, then invokes the escrow contract's `check_deadline()`
 * function. The contract itself decides whether the goal was met and
 * triggers refunds for donors when it was not.
 */
async function runDeadlineCheck() {
  logger.info(
    { event: "donation_goal_deadline_check_start" },
    "[RecurringDonationQueue] Starting daily funding deadline check"
  );

  try {
    const result = await pool.query(
      `SELECT id, contract_project_id, goal_amount, deadline_ledger
         FROM projects
        WHERE deadline_ledger IS NOT NULL
          AND deadline_resolved = false
          AND deadline_ledger <= $1`,
      [await getCurrentLedger()]
    );

    if (result.rows.length === 0) {
      logger.info(
        { event: "donation_goal_deadline_no_due" },
        "[RecurringDonationQueue] No funding deadlines due"
      );
      return;
    }

    const { checkDeadline } = require("./escrow");

    let checked = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        await checkDeadline({
          projectId: row.contract_project_id,
          goalAmount: row.goal_amount,
        });

        await pool.query(
          `UPDATE projects
              SET deadline_resolved = true, deadline_resolved_at = NOW()
            WHERE id = $1`,
          [row.id]
        );

        checked++;
      } catch (err) {
        errors++;
        logger.error(
          { event: "donation_goal_deadline_check_error", projectId: row.id, err },
          err.message
        );
      }
    }

    logger.info(
      { event: "donation_goal_deadline_check_complete", checked, errors },
      `[RecurringDonationQueue] Checked ${checked} funding deadlines (${errors} errors)`
    );
  } catch (err) {
    logger.error(
      { event: "donation_goal_deadline_query_error", err },
      err.message
    );
  }
}

/**
 * Resolve the current Stellar testnet ledger sequence number.
 *
 * The deadline is stored as a ledger number on the escrow contract, so the
 * background job needs to compare against the latest ledger. Uses the
 * Horizon endpoint configured via STELLAR_HORIZON_URL.
 *
 * @returns {Promise<number>}
 */
async function getCurrentLedger() {
  const horizonUrl =
    process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";

  const res = await fetch(`${horizonUrl}/ledgers?order=desc&limit=1&cursor=now`);
  if (!res.ok) {
    throw new Error(`Horizon ledger request failed with status ${res.status}`);
  }

  const body = await res.json();
  const record = Array.isArray(body._embedded)
    ? body._embedded.records[0]
    : body._embedded.records[0];

  if (!record || !record.sequence) {
    throw new Error("Unable to resolve current ledger from Horizon response");
  }

  return Number(record.sequence);
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
      "[RecurringDonationQueue] Disabled via RECURRING_DONATION_CRON"
    );
    return;
  }

  if (boss) return;

  boss = new PgBoss(
    {
      connectionString: process.env.DATABASE_URL || process.env.PGCONNECT_STRING,
    },
    {}
  );

  boss.on("error", (err) => {
    logger.error({ event: "recurring_donation_boss_error", err }, err.message);
  });

  await boss.start();

  // Worker for the daily reminder cron.
  await boss.work
    (QUEUE, async () => {
      await runReminderCheck();
    })
    ;

  // Worker for the daily funding deadline check.
  await boss.work
    (DEADLINE_QUEUE, async () => {
      await runDeadlineCheck();
    })
    ;

  // Worker for per-pledge scheduled jobs.
  await boss.work
    (PLEDGE_QUEUE, async (job) => {
      const { pledgeId } = job.data || {};
      if (!pledgeId) return;
      logger.info(
        { event: "recurring_donation_pledge_job", pledgeId },
        "[RecurringDonationQueue] Processing scheduled pledge job"
      );
    })
    ;

  // Daily cron for the reminder check.
  await boss.schedule(QUEUE, cronOverride || DEFAULT_CRON);
  // Daily cron for the funding deadline check.
  await boss.schedule(DEADLINE_QUEUE, cronOverride || DEFAULT_CRON);

  logger.info(
    { event: "recurring_donation_queue_started" },
    "[RecurringDonationQueue] Started pg-boss scheduler"
  );
}

/**
 * Stop the scheduler and close the pg-boss instance.
 */
async function stop() {
  if (!boss) return;
  try {
    await boss.stop();
  } catch (err) {
    logger.error({ event: "recurring_donation_boss_stop_error", err }, err.message);
  } finally {
    boss = null;
  }
}

module.exports = {
  scheduleRecurringDonationJob,
  cancelRecurringDonationJob,
  runReminderCheck,
  runDeadlineCheck,
  getCurrentLedger,
  start,
  stop,
};
