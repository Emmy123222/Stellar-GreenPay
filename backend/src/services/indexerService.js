/**
 * backend/src/services/indexerService.js
 */
"use strict";

const { server: stellarServer } = require("./stellar");
const pool = require("../db/pool");
const { v4: uuid } = require("uuid");
const { computeBadges } = require("./store");

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
    console.log(`[Indexer] Updated cache with ${projectWallets.size} project wallets.`);
  } catch (err) {
    console.error("[Indexer] Failed to update project wallets cache:", err.message);
  }
}

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

  console.log("[Indexer] Starting Horizon operations stream...");

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
          console.error("[Indexer] Error processing operation:", err.message);
        }
      },
      onerror: (err) => {
        console.error("[Indexer] Stream error:", err);
      }
    });
}

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

    console.log(`[Indexer] New donation: ${amountXLM} XLM from ${donorAddress} to project ${projectId}`);

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
    console.error("[Indexer] Failed to process donation:", err.message);
  } finally {
    client.release();
  }
}

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

module.exports = {
  startIndexer,
  getStatus
};
