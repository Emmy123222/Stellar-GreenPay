/**
 * src/routes/projects.js
 */
"use strict";
const express  = require("express");
const router   = express.Router();
const { projects } = require("../services/store");
const { getOnChainProject, CONTRACT_ID, server, NETWORK_PASSPHRASE } = require("../services/stellar");
const { Contract, TransactionBuilder, Operation } = require("@stellar/stellar-sdk");

const VALID_STATUSES    = ["active","completed","paused"];
const VALID_CATEGORIES  = ["Reforestation","Solar Energy","Ocean Conservation","Clean Water","Wildlife Protection","Carbon Capture","Wind Energy","Sustainable Agriculture","Other"];

router.get("/", (req, res) => {
  const { category, status, verified, limit = 50 } = req.query;
  let result = Array.from(projects.values());
  if (status && VALID_STATUSES.includes(status))     result = result.filter(p => p.status === status);
  if (category && VALID_CATEGORIES.includes(category)) result = result.filter(p => p.category === category);
  if (verified === "true") result = result.filter(p => p.verified === true);
  result = result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.min(parseInt(limit) || 50, 100));
  res.json({ success: true, data: result });
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

    const project = projects.get(projectId);
    if (project) {
      project.onChainVerified = true;
      project.verified = true;
      project.updatedAt = new Date().toISOString();
      projects.set(projectId, project);
    }

    res.json({ success: true, data: project });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found" });
  res.json({ success: true, data: p });
});

module.exports = router;
