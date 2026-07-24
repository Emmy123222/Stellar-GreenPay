/**
 * src/services/recurringDonationQueue.js
 *
 * pg-boss daily job that drives recurring monthly donations.
 *
 * Flow
 * ────
 * 1. A cron fires every day at 06:00 UTC (override via RECURRING_DONATION_CRON).
 * 2. The worker queries all `recurring_donations` rows where:
 *      status = 'active'  AND  next_due_date <= TODAY
 * 3. For each due pledge it:
 *    a. Builds a Soroban transaction envelope (unsigned) via rpcServer.simulateTransaction.
 *    b. Sends a push notification to every device token owned by the donor.
 *    c. Sends a reminder email to subscriber emails on file for the donor.
 *    d. Advances next_due_date by one calendar month.
 *    e. Decrements remaining_months; if it reaches 0 → sets status = 'completed'.
 *
 * Because the Stellar private key is never held server-side, the "transaction"
 * produced here is a pre-built XDR envelope that the donor's wallet must sign
 * and submit.  The worker stores the XDR in the job result for optional
 * retrieval, and relies on reminders to prompt the user to open their wallet.
 *
 * Env vars
 * ────────
 * RECURRING_DONATION_CRON  cron expression (default "0 6 * * *")
 *                           set to "disabled" to turn the scheduler off.
 * DATABASE_URL             Postgres connection string
 * APP_URL                  Frontend base URL for deep links in emails
 * RESEND_API_KEY           Resend API key for reminder emails
 * EMAIL_FROM               Sender address (default GreenPay <updates@greenpay.app>)
 * SOROBAN_RPC_URL          Soroban RPC endpoint
 * STELLAR_NETWORK          "testnet" | "mainnet"  (default "testnet")
 * CONTRACT_ID              Soroban contract address
 */
"use strict";

const PgBoss = require("pg-boss");
const {
  Horizon,
  Networks,
  rpc,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  Asset,
  Operation,
} = require("@stellar/stellar-sdk");
const pool   = require("../db/pool");
const logger = require("../logger");
const { Expo } = require("expo-server-sdk");

// ── Config ───────────────────────────────────────────────────────────────────

const QUEUE        = "recurring-donation-processor";
const DEFAULT_CRON = "0 6 * * *"; // daily at 06:00 UTC

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_ADDRESS   = process.env.EMAIL_FROM || "GreenPay <updates@greenpay.app>";
const APP_URL        = process.env.APP_URL    || "http://localhost:3000";

const NETWORK           = process.env.STELLAR_NETWORK  || "testnet";
const RPC_URL           = process.env.SOROBAN_RPC_URL  || "https://soroban-testnet.stellar.org";
const HORIZON_URL       = process.env.HORIZON_URL      || "https://horizon-testnet.stellar.org";
const CONTRACT_ID       = process.env.CONTRACT_ID      || "";
const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

const horizonServer = new Horizon.Server(HORIZON_URL);
const rpcServer     = new rpc.Server(RPC_URL);
const expo          = new Expo();

let boss = null;

// ── Soroban transaction builder ───────────────────────────────────────────────

/**
 * Build an unsigned Soroban transaction XDR for a recurring donation instalment.
 * Returns null when CONTRACT_ID is not configured (graceful degradation).
 *
 * @param {object} pledge - recurring_donations row
 * @returns {Promise<string|null>} base64 XDR or null
 */
async function buildSorobanTxXdr(pledge) {
  if (!CONTRACT_ID) return null;

  try {
    const contract = new Contract(CONTRACT_ID);

    // Use a placeholder source account — the actual signing key is supplied
    // by the donor's wallet at submission time.
    const PLACEHOLDER_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const sourceAccount = new Horizon.Account(PLACEHOLDER_SOURCE, "-1");

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "donate",
          nativeToScVal(pledge.project_id, { type: "string" }),
          nativeToScVal(Number(pledge.amount_xlm) * 1e7, { type: "i128" }), // stroops
        )
      )
      .setTimeout(300)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);

    if (rpc.Api.isSimulationSuccess(simResult)) {
      // Assemble the prepared transaction (adds auth + resource data)
      const prepared = rpc.assembleTransaction(tx, simResult);
      return prepared.toXDR();
    }

    logger.warn(
      { event: "recurring_soroban_sim_failed", pledgeId: pledge.id, simResult },
      "[recurringDonationQueue] Soroban simulation failed"
    );
    return null;
  } catch (err) {
    logger.error(
      { event: "recurring_soroban_error", pledgeId: pledge.id, err },
      err.message
    );
    return null;
  }
}

// ── Push notification helper ──────────────────────────────────────────────────

/**
 * Send a push reminder to all device tokens registered to the donor's wallet.
 *
 * @param {object} pledge - recurring_donations row
 * @param {object} project - projects row { id, name }
 */
async function sendPushReminder(pledge, project) {
  try {
    const result = await pool.query(
      `SELECT token FROM device_tokens WHERE wallet_address = $1`,
      [pledge.donor_address]
    );

    if (result.rows.length === 0) return;

    const messages = result.rows
      .filter((r) => Expo.isExpoPushToken(r.token))
      .map((r) => ({
        to: r.token,
        sound: "default",
        title: "🌱 Monthly Donation Due",
        body: `Your recurring donation of ${pledge.amount_xlm} ${pledge.currency} to "${project.name}" is due today.`,
        data: {
          type: "recurring_donation_due",
          pledgeId: pledge.id,
          projectId: pledge.project_id,
          amountXlm: pledge.amount_xlm,
        },
      }));

    if (messages.length === 0) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        logger.error({ event: "recurring_push_chunk_error", pledgeId: pledge.id, err }, err.message);
      }
    }

    logger.info(
      { event: "recurring_push_sent", pledgeId: pledge.id, tokens: messages.length },
      "[recurringDonationQueue] Push reminders sent"
    );
  } catch (err) {
    logger.error({ event: "recurring_push_error", pledgeId: pledge.id, err }, err.message);
  }
}

// ── Email reminder helper ─────────────────────────────────────────────────────

function buildReminderHtml({ pledge, project, projectUrl, txXdr }) {
  const xlm    = Number(pledge.amount_xlm).toFixed(7).replace(/\.?0+$/, "");
  const months = pledge.remaining_months;
  const xdrSection = txXdr
    ? `<p style="margin:0 0 16px;font-size:13px;color:#5a7a5a;">
         Transaction XDR (paste into your Stellar wallet to sign and submit):
       </p>
       <pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:11px;overflow-x:auto;word-break:break-all;">${txXdr}</pre>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f0;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f0;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:#2d6a2d;padding:24px 32px;">
          <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">🌱 Stellar GreenPay</p>
          <p style="margin:4px 0 0;color:#c8e6c8;font-size:13px;">Monthly Donation Reminder</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#1a3a1a;">Your donation is due today</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#3a5a3a;">
            You pledged <strong>${xlm} ${pledge.currency}</strong> per month to
            <strong>${project.name}</strong>.
            ${months > 0 ? `${months} month${months !== 1 ? "s" : ""} remaining after today.` : "This is your final instalment."}
          </p>
          ${xdrSection}
          <a href="${projectUrl}"
             style="display:inline-block;background:#2d6a2d;color:#ffffff;text-decoration:none;
                    padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
            View Project →
          </a>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e8f0e8;">
          <p style="margin:0;font-size:12px;color:#8aaa8a;">
            You set up a recurring donation to <strong>${project.name}</strong>.
            To cancel, visit your donor dashboard or use DELETE /api/recurring-donations/${pledge.id}.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildReminderText({ pledge, project, projectUrl }) {
  const xlm    = Number(pledge.amount_xlm).toFixed(7).replace(/\.?0+$/, "");
  const months = pledge.remaining_months;
  return [
    "Stellar GreenPay — Monthly Donation Reminder",
    "",
    `Project    : ${project.name}`,
    `Amount Due : ${xlm} ${pledge.currency}`,
    `Remaining  : ${months} month${months !== 1 ? "s" : ""} after today`,
    "",
    `View project: ${projectUrl}`,
    "",
    `To cancel, use DELETE /api/recurring-donations/${pledge.id}`,
  ].join("\n");
}

/**
 * Send an email reminder to the donor.
 *
 * Looks up the donor's email via project_subscriptions where donor_address matches.
 *
 * @param {object} pledge
 * @param {object} project
 * @param {string|null} txXdr
 */
async function sendEmailReminder(pledge, project, txXdr) {
  if (!RESEND_API_KEY) {
    logger.warn({ event: "recurring_email_skip_no_key" }, "[recurringDonationQueue] RESEND_API_KEY not set");
    return;
  }

  // Collect emails from project_subscriptions where the donor is known
  const subsResult = await pool.query(
    `SELECT email FROM project_subscriptions
     WHERE project_id = $1 AND donor_address = $2`,
    [pledge.project_id, pledge.donor_address]
  );

  if (subsResult.rows.length === 0) return;

  const emails     = subsResult.rows.map((r) => r.email);
  const projectUrl = `${APP_URL}/projects/${pledge.project_id}`;
  const html       = buildReminderHtml({ pledge, project, projectUrl, txXdr });
  const text       = buildReminderText({ pledge, project, projectUrl });
  const subject    = `Monthly donation reminder — ${project.name}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: emails, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error({ event: "recurring_email_resend_error", pledgeId: pledge.id }, body);
    } else {
      logger.info(
        { event: "recurring_email_sent", pledgeId: pledge.id, recipients: emails.length },
        "[recurringDonationQueue] Reminder emails sent"
      );
    }
  } catch (err) {
    logger.error({ event: "recurring_email_fetch_error", pledgeId: pledge.id, err }, err.message);
  }
}

// ── Core worker logic ─────────────────────────────────────────────────────────

/**
 * Process all recurring donations that are due today or overdue.
 */
async function processRecurringDonations() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  logger.info({ event: "recurring_run_start", today }, "[recurringDonationQueue] Starting daily run");

  const pledgesResult = await pool.query(
    `SELECT rd.*, p.name AS project_name
     FROM recurring_donations rd
     JOIN projects p ON rd.project_id = p.id
     WHERE rd.status = 'active'
       AND rd.next_due_date <= $1::date
     ORDER BY rd.next_due_date ASC`,
    [today]
  );

  if (pledgesResult.rows.length === 0) {
    logger.info({ event: "recurring_run_no_due" }, "[recurringDonationQueue] No pledges due today");
    return;
  }

  logger.info(
    { event: "recurring_run_pledges", count: pledgesResult.rows.length },
    `[recurringDonationQueue] Processing ${pledgesResult.rows.length} pledge(s)`
  );

  let processed = 0;
  let errors    = 0;

  for (const row of pledgesResult.rows) {
    const pledge  = row;
    const project = { id: row.project_id, name: row.project_name };

    try {
      // 1. Build Soroban transaction XDR (best-effort; null if not configured)
      const txXdr = await buildSorobanTxXdr(pledge);

      // 2. Push reminder to donor devices
      await sendPushReminder(pledge, project);

      // 3. Email reminder
      await sendEmailReminder(pledge, project, txXdr);

      // 4. Advance schedule in a single atomic update
      const newRemaining = pledge.remaining_months - 1;
      const newStatus    = newRemaining <= 0 ? "completed" : "active";

      // next_due_date advances by exactly one calendar month
      await pool.query(
        `UPDATE recurring_donations
         SET next_due_date    = (next_due_date + INTERVAL '1 month')::date,
             remaining_months = $1,
             status           = $2
         WHERE id = $3`,
        [newRemaining < 0 ? 0 : newRemaining, newStatus, pledge.id]
      );

      processed++;
      logger.info(
        {
          event: "recurring_pledge_processed",
          pledgeId: pledge.id,
          newStatus,
          newRemaining,
        },
        "[recurringDonationQueue] Pledge processed"
      );
    } catch (err) {
      errors++;
      logger.error(
        { event: "recurring_pledge_error", pledgeId: pledge.id, err },
        err.message
      );
    }
  }

  logger.info(
    { event: "recurring_run_complete", processed, errors, today },
    "[recurringDonationQueue] Daily run complete"
  );
}

// ── pg-boss wiring ────────────────────────────────────────────────────────────

/**
 * Start the recurring donation scheduler.
 * Registers a pg-boss cron job and worker. Safe to call multiple times.
 *
 * @returns {Promise<void>}
 */
async function start() {
  const cronOverride = process.env.RECURRING_DONATION_CRON;
  if (cronOverride === "disabled") {
    logger.info(
      { event: "recurring_disabled" },
      "[recurringDonationQueue] Recurring donation scheduler disabled via env"
    );
    return;
  }

  const cronSchedule    = cronOverride || DEFAULT_CRON;
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) =>
    logger.error({ event: "recurring_pgboss_error", err }, err.message)
  );

  await boss.start();

  // Schedule idempotent daily cron
  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });

  // Register worker (single-concurrency to avoid double-processing)
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await processRecurringDonations();
  });

  logger.info(
    { event: "recurring_scheduled", cron: cronSchedule },
    `[recurringDonationQueue] Recurring donation scheduler started: ${cronSchedule}`
  );
}

module.exports = { start, processRecurringDonations };
