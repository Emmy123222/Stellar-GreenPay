/**
 * src/routes/donations.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { v4: uuid } = require("uuid");
const { donations, projects, profiles } = require("../services/store");

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) { const e = new Error("Invalid Stellar public key"); e.status = 400; throw e; }
}

function validateTxHash(h) {
  if (!h || !/^[a-fA-F0-9]{64}$/.test(h)) { const e = new Error("Invalid transaction hash"); e.status = 400; throw e; }
}

// Badge thresholds in XLM
const BADGE_THRESHOLDS = [
  { tier: "earth",    min: 2000 },
  { tier: "forest",   min: 500 },
  { tier: "tree",     min: 100 },
  { tier: "seedling", min: 10 },
];

function computeBadges(totalXLM) {
  const earned = [];
  for (const b of BADGE_THRESHOLDS) {
    if (totalXLM >= b.min) { earned.push({ tier: b.tier, earnedAt: new Date().toISOString() }); break; }
  }
  return earned;
}

// POST /api/donations — record a donation after on-chain tx
router.post("/", (req, res, next) => {
  try {
    const { projectId, donorAddress, amountXLM, message, transactionHash } = req.body;
    validateKey(donorAddress);
    validateTxHash(transactionHash);

    const project = projects.get(projectId);
    if (!project) { const e = new Error("Project not found"); e.status = 404; throw e; }

    const amount = parseFloat(amountXLM);
    if (isNaN(amount) || amount <= 0) { const e = new Error("Invalid amount"); e.status = 400; throw e; }

    // Deduplicate by tx hash
    const existing = Array.from(donations.values()).find(d => d.transactionHash === transactionHash);
    if (existing) return res.json({ success: true, data: existing });

    const donation = {
      id: uuid(), projectId, donorAddress,
      amountXLM: amount.toFixed(7),
      message:   message?.trim().slice(0, 100) || null,
      transactionHash, createdAt: new Date().toISOString(),
    };
    donations.set(donation.id, donation);

    // Update project totals
    project.raisedXLM = (parseFloat(project.raisedXLM) + amount).toFixed(7);
    project.donorCount = Array.from(donations.values()).filter(d => d.projectId === projectId).map(d => d.donorAddress).filter((v, i, a) => a.indexOf(v) === i).length;
    project.updatedAt = new Date().toISOString();

    // Update donor profile
    const profile = profiles.get(donorAddress) || {
      publicKey: donorAddress, displayName: null, bio: null,
      totalDonatedXLM: "0", projectsSupported: 0,
      badges: [], createdAt: new Date().toISOString(),
    };
    const newTotal = parseFloat(profile.totalDonatedXLM) + amount;
    profile.totalDonatedXLM = newTotal.toFixed(7);
    profile.projectsSupported = Array.from(donations.values()).filter(d => d.donorAddress === donorAddress).map(d => d.projectId).filter((v,i,a) => a.indexOf(v) === i).length;
    profile.badges = computeBadges(newTotal);
    profiles.set(donorAddress, profile);

    res.status(201).json({ success: true, data: donation });
  } catch (e) { next(e); }
});

// GET /api/donations/project/:id
router.get("/project/:projectId", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

  let allDonations = Array.from(donations.values())
    .filter(d => d.projectId === req.params.projectId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Filter by cursor if provided (only get donations older than cursor)
  if (cursor) {
    allDonations = allDonations.filter(d => new Date(d.createdAt) < cursor);
  }

  const result = allDonations.slice(0, limit);
  const nextCursor = result.length === limit && allDonations.length > limit
    ? result[result.length - 1].createdAt
    : null;

  res.json({ success: true, data: result, nextCursor });
});

// GET /api/donations/donor/:publicKey
router.get("/donor/:publicKey", (req, res, next) => {
  try {
    validateKey(req.params.publicKey);
    const result = Array.from(donations.values())
      .filter(d => d.donorAddress === req.params.publicKey)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

module.exports = router;
