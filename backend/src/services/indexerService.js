/**
 * backend/src/services/indexerService.js
 */
"use strict";

const { server: stellarServer, getProjectDeactivatedEvents } = require("./stellar");
const { sendRecurringDonationCancelledEmail } = require("./email");
const pool = require("../db/pool");
const { v4: uuid } = require("uuid");
const { computeBadges } = require("./store");
const { checkAndDeliverMilestones } = require("./webhook");
const donationEvents = require("./donationEvents");
const logger = require("../logger");

let lastProcessedLedger = 0;
let lastDeactivationLedger = 0;
let isRunning = false;
let io = null;
let projectWallets = new Map(); // wallet_address -> project_id
let deactivationPollTimer = null;

/**
 * Fetch all active project wallets and cache them.
 */
async function updateProjectWallets() {
  try {
    const result = await pool.query("SELECT id, wallet_address FROM projects WHERE status = 'active'");
    projectWallets.clear();
    for (const row of result.rows) {
      projectWallets.set(row.wallet_address, row.id);
    }
    logger.debug({ event: "indexer_wallets_refreshed", count: projectWallets.size }, "Project wallet cache updated");
  } catch (err) {
    logger.error({ event: "indexer_wallets_refresh_error", err }, err.message);
  }
}

/**
 * Refresh the in-memory cache of active project wallet addresses.
 *
 * @returns {Promise<void>} Resolves after the cache is updated.
 */
// internal helper

/**
 * Start the Stellar indexer service.
 * @param {Object} socketIo - The Socket.io server instance.
 */
async function startIndexer(socketIo) {
  if (isRunning) return;
  isRunning = true;
  io = socketIo;

  await updateProjectWallets();
  // Refresh cache every 10 minutes
  setInterval(updateProjectWallets, 10 * 60 * 1000);

  logger.info({ event: "indexer_started" }, "Starting Horizon operations stream");

  // Poll Soroban contract events for ProjectDeactivated
  pollDeactivationEvents().catch(() => {});
  if (!deactivationPollTimer) {
    deactivationPollTimer = setInterval(pollDeactivationEvents, 30 * 1000);
  }

  // Start streaming operations from 'now'
  stellarServer.operations()
    .cursor("now")
    .stream({
      onmessage: async (op) => {
        try {
          lastProcessedLedger = op.ledger_attr;

          // We only care about XLM payments
          if (op.type === "payment" && op.asset_type === "native") {
            const projectId = projectWallets.get(op.to);
            if (projectId) {
              await handleDonation(projectId, op);
            }
          }
        } catch (err) {
          logger.error({ event: "indexer_op_error", err }, err.message);
        }
      },
      onerror: (err) => {
        logger.error({ event: "indexer_horizon_stream_error", err }, "Horizon stream error");
      }
    });
}

/**
 * Start the Stellar indexer service which streams Horizon operations and
 * processes project donations.
 *
 * @param {import('socket.io').Server} socketIo - Socket.io server instance used for websocket events.
 * @returns {Promise<void>} Resolves when the indexer is started.
 */
// exported as `startIndexer`

/**
 * Handle a payment to a project.
 */
async function handleDonation(projectId, op) {
  const txHash = op.transaction_hash;
  const donorAddress = op.from;
  const amountXLM = parseFloat(op.amount);

  const client = await pool.connect();
  let inTransaction = false;

  try {
    // 1. Deduplicate by transaction hash
    const existingResult = await client.query(
      "SELECT id FROM donations WHERE transaction_hash = $1",
      [txHash]
    );
    if (existingResult.rows.length > 0) {
      return;
    }

    await client.query("BEGIN");
    inTransaction = true;

    // 2. Record the donation
    const donationId = uuid();
    await client.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, 'XLM', $6, NOW())`,
      [donationId, projectId, donorAddress, amountXLM, amountXLM, txHash]
    );

    // 3. Update project raised amount and donor count
    await client.query(
      `UPDATE projects
       SET raised_xlm = raised_xlm + $1,
           donor_count = (SELECT COUNT(DISTINCT donor_address) FROM donations WHERE project_id = $2),
           updated_at = NOW()
       WHERE id = $2`,
      [amountXLM, projectId]
    );

    // 4. Update donor profile (total donated, projects supported, badges)
    const existingProfileResult = await client.query(
      "SELECT total_donated_xlm FROM profiles WHERE public_key = $1",
      [donorAddress]
    );
    const existingProfile = existingProfileResult.rows[0];
    const previousTotal = existingProfile ? parseFloat(existingProfile.total_donated_xlm || "0") : 0;
    const newTotal = previousTotal + amountXLM;
    
    const projectsSupportedResult = await client.query(
      "SELECT COUNT(DISTINCT project_id) AS count FROM donations WHERE donor_address = $1",
      [donorAddress]
    );
    const projectsSupported = parseInt(projectsSupportedResult.rows[0].count, 10) || 1;
    const badges = computeBadges(newTotal);

    await client.query(
      `INSERT INTO profiles (public_key, total_donated_xlm, projects_supported, badges, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (public_key) DO UPDATE SET
         total_donated_xlm = EXCLUDED.total_donated_xlm,
         projects_supported = EXCLUDED.projects_supported,
         badges = EXCLUDED.badges,
         updated_at = NOW()`,
      [donorAddress, newTotal.toFixed(7), projectsSupported, JSON.stringify(badges)]
    );

    await client.query("COMMIT");
    inTransaction = false;

    logger.info({
      event: "indexer_donation_recorded",
      amount: amountXLM,
      currency: "XLM",
      project: projectId,
      donor: donorAddress,
      txHash,
    }, "Indexer donation recorded");

    // 5. Emit WebSocket event
    if (io) {
      const payload = {
        projectId,
        donorAddress,
        amountXLM,
        txHash,
        timestamp: new Date().toISOString()
      };
      if (typeof io.to === "function") {
        io.to([`project:${projectId}`, "all-donations"]).emit("newDonation", payload);
      } else if (typeof io.emit === "function") {
        io.emit("newDonation", payload);
      }
    }

    // 6. Emit SSE event with enriched payload
    let projectName = "Unknown Project";
    let donorBadge = "";
    try {
      const projectResult = await client.query("SELECT name FROM projects WHERE id = $1", [projectId]);
      if (projectResult.rows[0]) projectName = projectResult.rows[0].name;
    } catch {
      // best-effort
    }
    if (badges.length > 0) {
      const tier = badges[0].tier;
      donorBadge = tier.charAt(0).toUpperCase() + tier.slice(1);
    }
    donationEvents.emit("new_donation", {
      projectName,
      amountXLM: String(amountXLM),
      donorBadge,
    });

    // 7. Check milestones asynchronously
    checkAndDeliverMilestones(projectId).catch(() => {});
  } catch (err) {
    if (inTransaction) await client.query("ROLLBACK");
    logger.error({ event: "indexer_donation_error", project: projectId, txHash, err }, err.message);
  } finally {
    client.release();
  }
}

/**
 * Handle a Horizon payment operation observed for a project wallet.
 *
 * @param {string} projectId - Internal project UUID.
 * @param {object} op - Horizon operation object for the payment.
 * @returns {Promise<void>} Resolves once processing (DB updates, profiles) completes.
 */
// internal helper

/**
 * Returns the indexer status for the health endpoint.
 */
function getStatus() {
  return {
    isRunning,
    lastProcessedLedger,
    lastDeactivationLedger,
    projectWalletsCount: projectWallets.size,
    timestamp: new Date().toISOString()
  };
}

/**
 * Handle a project deactivation event.
 * Cancels all recurring donations for the project and notifies donors via email.
 *
 * @param {string} projectId - Project identifier (UUID or wallet address).
 * @returns {Promise<{ cancelledCount: number }>}
 */
async function handleProjectDeactivated(projectId) {
  if (!projectId) return { cancelledCount: 0 };

  const client = await pool.connect();
  let inTransaction = false;

  try {
    // 1. Find all active/pending recurring donations for this project
    const donationsResult = await client.query(
      `SELECT rd.id, rd.donor_address, p.name AS project_name
       FROM recurring_donations rd
       JOIN projects p ON rd.project_id = p.id
       WHERE (p.id::text = $1 OR p.wallet_address = $1)
         AND (rd.status IS NULL OR rd.status NOT IN ('cancelled', 'completed'))`,
      [projectId]
    );

    const activeDonations = donationsResult.rows;

    await client.query("BEGIN");
    inTransaction = true;

    // 2. Cancel recurring donations for the project
    try {
      await client.query(
        `UPDATE recurring_donations
         SET status = 'cancelled', active = false, updated_at = NOW()
         WHERE project_id IN (
           SELECT id FROM projects WHERE id::text = $1 OR wallet_address = $1
         )
         AND (status IS NULL OR status NOT IN ('cancelled', 'completed'))`,
        [projectId]
      );
    } catch {
      await client.query(
        `UPDATE recurring_donations
         SET status = 'cancelled'
         WHERE project_id IN (
           SELECT id FROM projects WHERE id::text = $1 OR wallet_address = $1
         )
         AND (status IS NULL OR status NOT IN ('cancelled', 'completed'))`,
        [projectId]
      );
    }

    await client.query("COMMIT");
    inTransaction = false;

    logger.info(
      { event: "project_deactivated_recurring_cancelled", projectId, count: activeDonations.length },
      `Cancelled ${activeDonations.length} recurring donations for deactivated project ${projectId}`
    );

    // 3. Notify donors by email
    for (const donation of activeDonations) {
      try {
        const subResult = await pool.query(
          `SELECT email FROM project_subscriptions
           WHERE donor_address = $1 AND (unsubscribed = false OR unsubscribed IS NULL)
           ORDER BY (project_id IN (SELECT id FROM projects WHERE id::text = $2 OR wallet_address = $2)) DESC, created_at DESC
           LIMIT 1`,
          [donation.donor_address, projectId]
        );

        const email = subResult.rows[0]?.email;
        if (email) {
          await sendRecurringDonationCancelledEmail({
            email,
            projectName: donation.project_name,
            donationId: donation.id,
          });
        }
      } catch (emailErr) {
        logger.error(
          { event: "recurring_cancellation_email_error", donationId: donation.id, err: emailErr },
          emailErr.message
        );
      }
    }

    return { cancelledCount: activeDonations.length };
  } catch (err) {
    if (inTransaction) await client.query("ROLLBACK");
    logger.error({ event: "handle_project_deactivated_error", projectId, err }, err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Poll Soroban RPC for ProjectDeactivated contract events and process them.
 */
async function pollDeactivationEvents() {
  try {
    const events = await getProjectDeactivatedEvents(lastDeactivationLedger || undefined);
    for (const evt of events) {
      if (evt.ledger && evt.ledger > lastDeactivationLedger) {
        lastDeactivationLedger = evt.ledger;
      }
      if (evt.projectId) {
        await handleProjectDeactivated(evt.projectId);
      }
    }
  } catch (err) {
    logger.error({ event: "poll_deactivation_events_error", err }, err.message);
  }
}

/**
 * Stop the indexer and timers.
 */
function stopIndexer() {
  if (deactivationPollTimer) {
    clearInterval(deactivationPollTimer);
    deactivationPollTimer = null;
  }
  isRunning = false;
}

module.exports = {
  startIndexer,
  stopIndexer,
  getStatus,
  handleProjectDeactivated,
  pollDeactivationEvents,
};
