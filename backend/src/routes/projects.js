/**
 * src/routes/projects.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { mapProjectRow } = require("../services/store");
const { getOnChainProject, CONTRACT_ID, server, NETWORK_PASSPHRASE } = require("../services/stellar");
const { Contract, TransactionBuilder } = require("@stellar/stellar-sdk");

const VALID_STATUSES = ["active", "completed", "paused"];
const VALID_CATEGORIES = [
  "Reforestation",
  "Solar Energy",
  "Ocean Conservation",
  "Clean Water",
  "Wildlife Protection",
  "Carbon Capture",
  "Wind Energy",
  "Sustainable Agriculture",
  "Other",
];

/**
 * GET /api/projects/featured
 * Returns the project with the highest donorCount (active projects only).
 * Result is cached in memory for 24 hours.
 */
let featuredCache = null;
let featuredCacheExpiry = 0;

router.get("/featured", async (req, res, next) => {
  try {
    const now = Date.now();
    if (featuredCache && now < featuredCacheExpiry) {
      return res.json({ success: true, data: featuredCache });
    }

    const result = await pool.query(
      `SELECT * FROM projects
       WHERE status = 'active'
       ORDER BY donor_count DESC, raised_xlm DESC
       LIMIT 1`,
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "No featured project found" });
    }

    featuredCache = mapProjectRow(result.rows[0]);
    featuredCacheExpiry = now + 24 * 60 * 60 * 1000; // 24 hours
    res.json({ success: true, data: featuredCache });
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { category, status, verified, search, limit = 50 } = req.query;
    const where = [];
    const values = [];

    if (status && VALID_STATUSES.includes(status)) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      values.push(category);
      where.push(`category = $${values.length}`);
    }
    if (verified === "true") {
      where.push("verified = true");
    }
    if (search && typeof search === "string") {
      values.push(`%${search}%`);
      where.push(`(
        name ILIKE $${values.length}
        OR description ILIKE $${values.length}
        OR location ILIKE $${values.length}
        OR EXISTS (
          SELECT 1
          FROM unnest(tags) AS tag
          WHERE tag ILIKE $${values.length}
        )
      )`);
    }

    values.push(Math.min(Number.parseInt(limit, 10) || 50, 100));
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT * FROM projects ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values,
    );

    res.json({ success: true, data: result.rows.map(mapProjectRow) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/projects/:id/verify
 * Reads the project record directly from the Soroban contract.
 */
router.get("/:id/verify", async (req, res) => {
  try {
    const onChainProject = await getOnChainProject(req.params.id);
    if (!onChainProject) {
      return res.status(404).json({ success: false, error: "Project not found on-chain" });
    }
    res.json({ success: true, data: onChainProject });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/projects/admin/register
 * Builds a Soroban transaction to register a project on-chain.
 * Returns the XDR for the admin to sign.
 */
router.post("/admin/register", async (req, res) => {
  try {
    const { projectId, name, wallet, co2PerXLM, adminAddress } = req.body;
    
    if (!CONTRACT_ID) throw new Error("CONTRACT_ID not configured");
    if (!adminAddress) throw new Error("adminAddress is required");

    const contract = new Contract(CONTRACT_ID);
    const sourceAccount = await server.loadAccount(adminAddress);

    const tx = new TransactionBuilder(sourceAccount, { 
      fee: "1000", 
      networkPassphrase: NETWORK_PASSPHRASE 
    })
    .addOperation(contract.call("register_project", adminAddress, projectId, name, wallet, parseInt(co2PerXLM)))
    .setTimeout(30)
    .build();

    res.json({ success: true, xdr: tx.toXDR() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/projects/admin/confirm
 * Verifies a registration transaction and updates the local store.
 */
router.post("/admin/confirm", async (req, res) => {
  try {
    const { transactionHash, projectId } = req.body;
    
    const tx = await server.getTransaction(transactionHash);
    if (!tx.successful) throw new Error("Transaction failed");

    const result = await pool.query(
      `UPDATE projects
       SET on_chain_verified = true,
           verified = true,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [projectId],
    );

    res.json({ success: true, data: result.rows[0] ? mapProjectRow(result.rows[0]) : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Project not found" });
    res.json({ success: true, data: mapProjectRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
