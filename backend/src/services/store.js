/**
 * src/services/store.js
 * In-memory store with seed climate project data.
 * Replace with PostgreSQL in v1.1 — see ROADMAP.md.
 */
"use strict";

const { v4: uuid } = require("uuid");

const projects    = new Map();
const donations   = new Map();
const profiles    = new Map();
const updates     = new Map();

// ── Seed projects ─────────────────────────────────────────────────────────────
const seedProjects = [
  {
    id: uuid(), name: "Amazon Reforestation Initiative",
    description: "Planting 1 million native trees in the Brazilian Amazon to restore biodiversity and capture CO₂. Every XLM donated funds the planting and care of native species selected by local communities.",
    category: "Reforestation", location: "Brazil, South America",
    walletAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "50000", raisedXLM: "18420", donorCount: 147,
    co2OffsetKg: 245000, status: "active", verified: true, onChainVerified: true,
    tags: ["reforestation", "biodiversity", "amazon", "indigenous"],
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: uuid(), name: "Solar Microgrids for Rural Kenya",
    description: "Installing solar microgrids in 50 off-grid villages in rural Kenya, providing clean electricity to 10,000 people and replacing diesel generators that emit over 500 tonnes of CO₂ per year.",
    category: "Solar Energy", location: "Kenya, East Africa",
    walletAddress: "GBVNQON4MFVGJXK5WT7VQJJZXFVHZJB6BHFWJCW7OF5BLNGOLZJQHIY",
    goalXLM: "75000", raisedXLM: "52310", donorCount: 312,
    co2OffsetKg: 500000, status: "active", verified: true,
    tags: ["solar", "africa", "energy-access", "microgrids"],
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: uuid(), name: "Pacific Ocean Plastic Cleanup",
    description: "Deploying autonomous ocean cleanup vessels in the North Pacific Gyre to remove plastic pollution. Collected plastic is recycled into construction materials for low-income housing.",
    category: "Ocean Conservation", location: "North Pacific Ocean",
    walletAddress: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP",
    goalXLM: "100000", raisedXLM: "31800", donorCount: 208,
    co2OffsetKg: 85000, status: "active", verified: true,
    tags: ["ocean", "plastic", "recycling", "cleanup"],
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: uuid(), name: "Clean Water Wells — Sub-Saharan Africa",
    description: "Drilling and maintaining clean water wells for rural communities in Mali and Niger, reducing the need to boil water over wood fires — saving forests and preventing CO₂ emissions.",
    category: "Clean Water", location: "Mali & Niger, West Africa",
    walletAddress: "GBSJ7KFU2NXACVHVN2VWIMFZQMQM4NJJ7NKFRRL2GWWI5EKWGYNIFZ7",
    goalXLM: "30000", raisedXLM: "24100", donorCount: 186,
    co2OffsetKg: 120000, status: "active", verified: false,
    tags: ["water", "africa", "community", "health"],
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

seedProjects.forEach(p => projects.set(p.id, p));

// Seed one update for first project
const firstProject = seedProjects[0];
const updateId = uuid();
updates.set(updateId, {
  id: updateId,
  projectId: firstProject.id,
  title: "5,000 trees planted in first month!",
  body: "Thanks to donations from our incredible community, we have already planted 5,000 native trees in the Pará state. The saplings are thriving and local families are being trained as forest stewards. Thank you to every donor who made this possible.",
  createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
});

module.exports = { projects, donations, profiles, updates };
