/**
 * src/routes/certificate.js — donation impact certificates.
 *
 * Restores the module server.js historically required as `./routes/certificate`
 * but that was never committed (issue #1523): the require pointed at a file
 * that did not exist, so the API died with MODULE_NOT_FOUND on boot. When the
 * require and its mounts were dropped to unblock startup, the certificate
 * endpoints disappeared with them.
 *
 * Mounted at /api/impact/certificate and /api/v1/impact/certificate (see
 * server.js), so the endpoint below is served at e.g.
 *   GET /api/impact/certificate/donation/:id
 *
 * The `/donation` sub-path deliberately keeps this router clear of the impact
 * router's public share endpoint (GET /api/impact/certificate/:slug, issue
 * #1295), which owns single-segment paths under the same prefix regardless of
 * mount order.
 *
 * GET /donation/:id — certificate payload for one donation. `:id` may be the
 * donation UUID or its 64-character Stellar transaction hash.
 *   400 — id is neither a UUID nor a transaction hash
 *   404 — no such donation
 */
"use strict";

const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const KG_CO2_PER_TREE_CERT = 21.77; // consistent with impact.js / projects.js

/**
 * Stellar Explorer link for a transaction. Defaults to testnet, mirroring the
 * on-chain link used by the project impact certificate.
 */
function buildOnChainUrl(transactionHash) {
  const network = process.env.STELLAR_NETWORK || "testnet";
  if (network === "mainnet" || network === "public") {
    return `https://stellar.expert/explorer/public/tx/${transactionHash}`;
  }
  return `https://stellar.expert/explorer/testnet/tx/${transactionHash}`;
}

router.get("/donation/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const isDonationId = UUID_PATTERN.test(id);
    const isTransactionHash = TX_HASH_PATTERN.test(id);

    if (!isDonationId && !isTransactionHash) {
      return res.status(400).json({ success: false, error: "Invalid donation id" });
    }

    // Two static statements rather than one interpolated string: the lookup
    // column depends on the id shape, and user input never enters the SQL.
    let result;
    if (isDonationId) {
      result = await pool.query(
        `SELECT d.id, d.project_id, d.donor_address, d.transaction_hash,
                COALESCE(d.amount_xlm, d.amount) AS amount_xlm,
                d.currency, d.created_at,
                p.name AS project_name, p.category AS project_category,
                p.verified AS project_verified,
                p.on_chain_verified AS project_on_chain_verified,
                p.co2_per_xlm,
                pr.display_name AS donor_name
           FROM donations d
           JOIN projects p ON p.id = d.project_id
           LEFT JOIN profiles pr ON pr.public_key = d.donor_address
          WHERE d.id = $1`,
        [id],
      );
    } else {
      result = await pool.query(
        `SELECT d.id, d.project_id, d.donor_address, d.transaction_hash,
                COALESCE(d.amount_xlm, d.amount) AS amount_xlm,
                d.currency, d.created_at,
                p.name AS project_name, p.category AS project_category,
                p.verified AS project_verified,
                p.on_chain_verified AS project_on_chain_verified,
                p.co2_per_xlm,
                pr.display_name AS donor_name
           FROM donations d
           JOIN projects p ON p.id = d.project_id
           LEFT JOIN profiles pr ON pr.public_key = d.donor_address
          WHERE d.transaction_hash = $1`,
        [id],
      );
    }

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, error: "Certificate not found" });
    }

    const amountXlm = Number.parseFloat(row.amount_xlm?.toString() || "0");
    const co2PerXlm = Number.parseFloat(row.co2_per_xlm?.toString() || "0");
    const co2OffsetKg = Math.round(amountXlm * co2PerXlm);
    const treesEquivalent =
      co2OffsetKg > 0 ? Number((co2OffsetKg / KG_CO2_PER_TREE_CERT).toFixed(2)) : 0;

    return res.json({
      success: true,
      data: {
        donationId: row.id,
        transactionHash: row.transaction_hash,
        recordUrl: buildOnChainUrl(row.transaction_hash),
        donorAddress: row.donor_address,
        donorName: row.donor_name || null,
        projectId: row.project_id,
        projectName: row.project_name,
        projectCategory: row.project_category,
        projectVerified: Boolean(row.project_verified) || Boolean(row.project_on_chain_verified),
        amountXLM: amountXlm.toFixed(7),
        currency: row.currency || "XLM",
        co2OffsetKg,
        treesEquivalent,
        donatedAt: new Date(row.created_at).toISOString(),
        issuedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
