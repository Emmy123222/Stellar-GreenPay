/**
 * backend/src/services/indexerService.js
 */
"use strict";

const { server: stellarServer } = require("./stellar");
const pool = require("../db/pool");
const { v4: uuid } = require("uuid");
const { computeBadges } = require("./store");
const logger = require("../logger");

let lastProcessedLedger = 0;
let isRunning = false;
let io = null;
let projectWallets = new Map(); // wallet_address -> project_id

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
      io.emit("newDonation", {
        projectId,
        donorAddress,
        amountXLM,
        txHash,
        timestamp: new Date().toISOString()
      });
    }
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
    projectWalletsCount: projectWallets.size,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get the current indexer status used by the health endpoint.
 *
 * @returns {{isRunning:boolean,lastProcessedLedger:number,projectWalletsCount:number,timestamp:string}}
 */
// exported as `getStatus`

module.exports = {
  startIndexer,
  getStatus
};
