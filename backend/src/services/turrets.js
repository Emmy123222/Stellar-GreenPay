/**
 * services/turrets.js
 * Stellar Turrets txFunction server for automatic donation matching
 * 
 * This service implements a Turrets-compatible txFunction that:
 * 1. Listens for payments to project wallets
 * 2. Checks for active matching offers
 * 3. Submits pre-signed matching transactions from the matcher account
 */

const { Server, TransactionBuilder, Networks, Operation, Asset, Horizon } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");

// Network configuration
const NETWORK = process.env.STELLAR_NETWORK || "testnet";
const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Server(HORIZON_URL);

/**
 * Turrets txFunction entry point for matching donations
 * This function is called by the Turret when a payment is detected
 */
async function matchDonationTxFunction(payment) {
  try {
    const { 
      transaction_hash, 
      from, 
      to, 
      amount, 
      asset_code, 
      asset_type,
      memo 
    } = payment;

    // Only match XLM donations
    if (asset_type !== "native" && asset_code !== "XLM") {
      console.log(`Skipping non-XLM donation: ${asset_code || asset_type}`);
      return { matched: false, reason: "Not an XLM donation" };
    }

    // Find the project by wallet address
    const projectResult = await pool.query(
      "SELECT id, name FROM projects WHERE wallet_address = $1",
      [to]
    );

    if (!projectResult.rows[0]) {
      console.log(`Project not found for wallet: ${to}`);
      return { matched: false, reason: "Project not found" };
    }

    const project = projectResult.rows[0];
    const donationAmount = parseFloat(amount);

    // Check for active matching offers
    const matchesResult = await pool.query(
      `SELECT id, matcher_address, cap_xlm, matched_xlm, multiplier
       FROM donation_matches
       WHERE project_id = $1 AND expires_at > NOW()
       ORDER BY created_at ASC`,
      [project.id]
    );

    if (matchesResult.rows.length === 0) {
      console.log(`No active matching offers for project: ${project.id}`);
      return { matched: false, reason: "No active matching offers" };
    }

    // Process matching offers
    let totalMatched = 0;
    const matchResults = [];

    for (const match of matchesResult.rows) {
      const matchedXlm = parseFloat(match.matched_xlm || "0");
      const capXlm = parseFloat(match.cap_xlm);
      const remaining = capXlm - matchedXlm;

      if (remaining <= 0) continue;

      const matchAmount = Math.min(donationAmount * match.multiplier, remaining);

      if (matchAmount <= 0) continue;

      // Build and submit the matching payment transaction
      const matchResult = await submitMatchingPayment({
        matcherAddress: match.matcher_address,
        projectWallet: to,
        amount: matchAmount,
        originalTxHash: transaction_hash,
        matchId: match.id,
        projectId: project.id
      });

      if (matchResult.success) {
        // Update the matched amount in the database
        await pool.query(
          `UPDATE donation_matches 
           SET matched_xlm = matched_xlm + $1 
           WHERE id = $2`,
          [matchAmount, match.id]
        );

        // Record the matched donation
        await pool.query(
          `INSERT INTO donations (
            id, project_id, donor_address, amount_xlm, amount, currency, 
            message, transaction_hash, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            require("uuid").v4(),
            project.id,
            match.matcher_address,
            matchAmount,
            matchAmount,
            "XLM",
            `Matching donation for ${from}`,
            matchResult.txHash
          ]
        );

        totalMatched += matchAmount;
        matchResults.push({
          matchId: match.id,
          matcherAddress: match.matcher_address,
          amount: matchAmount,
          txHash: matchResult.txHash
        });
      }
    }

    return {
      matched: totalMatched > 0,
      totalMatched,
      matches: matchResults,
      projectId: project.id,
      projectName: project.name
    };

  } catch (error) {
    console.error("Error in matchDonationTxFunction:", error);
    return { matched: false, error: error.message };
  }
}

/**
 * Submit a matching payment transaction
 * This uses pre-signed transactions from the matcher's account
 */
async function submitMatchingPayment({
  matcherAddress,
  projectWallet,
  amount,
  originalTxHash,
  matchId,
  projectId
}) {
  try {
    // Load the matcher account
    const matcherAccount = await server.loadAccount(matcherAddress);

    // Build the payment transaction
    const transaction = new TransactionBuilder(matcherAccount, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(
        Operation.payment({
          destination: projectWallet,
          asset: Asset.native(),
          amount: amount.toFixed(7)
        })
      )
      .addMemo(
        Operation.memo({
          type: "text",
          value: `Match:${originalTxHash.slice(0, 20)}`
        })
      )
      .setTimeout(60)
      .build();

    // In a real implementation, this would use pre-signed transactions
    // For now, we'll need the matcher's secret key to sign
    // This should be stored securely (e.g., in environment variables or a secret manager)
    const matcherSecret = process.env.MATCHER_SECRET_KEY;
    
    if (!matcherSecret) {
      console.warn("MATCHER_SECRET_KEY not configured. Cannot submit matching payment.");
      return { success: false, reason: "Matcher secret not configured" };
    }

    // Sign the transaction
    transaction.sign(require("@stellar/stellar-sdk").Keypair.fromSecret(matcherSecret));

    // Submit to Horizon
    const result = await server.submitTransaction(transaction);

    console.log(`Matching payment submitted: ${result.hash}`);

    return {
      success: true,
      txHash: result.hash
    };

  } catch (error) {
    console.error("Error submitting matching payment:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate pre-signed transactions for a matcher up to a cap
 * This allows the Turret to submit transactions without needing the secret key at runtime
 */
async function generatePreSignedTransactions({
  matcherAddress,
  matcherSecret,
  projectWallet,
  capXlm,
  multiplier,
  projectId
}) {
  const transactions = [];
  const matcherKeypair = require("@stellar/stellar-sdk").Keypair.fromSecret(matcherSecret);
  
  // Generate transactions for different donation amounts
  const donationAmounts = [10, 25, 50, 100, 250];
  
  for (const donationAmount of donationAmounts) {
    const matchAmount = Math.min(donationAmount * multiplier, capXlm);
    
    if (matchAmount <= 0) continue;

    try {
      const account = await server.loadAccount(matcherAddress);
      
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE
      })
        .addOperation(
          Operation.payment({
            destination: projectWallet,
            asset: Asset.native(),
            amount: matchAmount.toFixed(7)
          })
        )
        .setTimeout(60)
        .build();

      tx.sign(matcherKeypair);
      
      transactions.push({
        donationAmount,
        matchAmount,
        xdr: tx.toXDR()
      });
    } catch (error) {
      console.error(`Error generating transaction for ${donationAmount} XLM:`, error);
    }
  }

  return transactions;
}

/**
 * Start the Turrets server
 * This creates an HTTP server that Turrets can call
 */
function startTurretsServer(port = 3001) {
  const express = require("express");
  const app = express();

  app.use(express.json());
  app.use(require("cors")());

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "turrets-matching" });
  });

  // txFunction endpoint for matching donations
  app.post("/txfunction/matchDonation", async (req, res) => {
    try {
      const result = await matchDonationTxFunction(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error in txFunction:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint to generate pre-signed transactions
  app.post("/admin/presign", async (req, res) => {
    try {
      const {
        matcherAddress,
        matcherSecret,
        projectWallet,
        capXlm,
        multiplier,
        projectId
      } = req.body;

      if (!matcherAddress || !matcherSecret || !projectWallet) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const transactions = await generatePreSignedTransactions({
        matcherAddress,
        matcherSecret,
        projectWallet,
        capXlm: parseFloat(capXlm),
        multiplier: parseFloat(multiplier),
        projectId
      });

      res.json({ success: true, transactions });
    } catch (error) {
      console.error("Error generating pre-signed transactions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.listen(port, () => {
    console.log(`Turrets server listening on port ${port}`);
  });

  return app;
}

module.exports = {
  matchDonationTxFunction,
  submitMatchingPayment,
  generatePreSignedTransactions,
  startTurretsServer
};
