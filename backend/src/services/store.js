/**
 * src/services/store.js
 * Shared DB seed data and row mappers.
 */
"use strict";

const now = Date.now();

const seedProjects = [
  {
    id: "8d9ac19b-52eb-42f7-80d9-19a88ba59e43",
    name: "Amazon Reforestation Initiative",
    description:
      "Planting 1 million native trees in the Brazilian Amazon to restore biodiversity and capture CO2. Every XLM donated funds the planting and care of native species selected by local communities.",
    category: "Reforestation",
    location: "Brazil, South America",
    walletAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "50000",
    raisedXLM: "18420",
    donorCount: 147,
    co2OffsetKg: 245000,
    status: "active",
    verified: true,
    onChainVerified: true,
    tags: ["reforestation", "biodiversity", "amazon", "indigenous"],
    createdAt: new Date(now - 30 * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  },
  {
    id: "4d57d6cb-5e8e-4647-a5f0-acfbb9f0ce10",
    name: "Solar Microgrids for Rural Kenya",
    description:
      "Installing solar microgrids in 50 off-grid villages in rural Kenya, providing clean electricity to 10,000 people and replacing diesel generators that emit over 500 tonnes of CO2 per year.",
    category: "Solar Energy",
    location: "Kenya, East Africa",
    walletAddress: "GBVNQON4MFVGJXK5WT7VQJJZXFVHZJB6BHFWJCW7OF5BLNGOLZJQHIY",
    goalXLM: "75000",
    raisedXLM: "52310",
    donorCount: 312,
    co2OffsetKg: 500000,
    status: "active",
    verified: true,
    onChainVerified: false,
    tags: ["solar", "africa", "energy-access", "microgrids"],
    createdAt: new Date(now - 60 * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  },
  {
    id: "2dfd56b9-67ac-451d-8b6c-4ab6a71ad589",
    name: "Pacific Ocean Plastic Cleanup",
    description:
      "Deploying autonomous ocean cleanup vessels in the North Pacific Gyre to remove plastic pollution. Collected plastic is recycled into construction materials for low-income housing.",
    category: "Ocean Conservation",
    location: "North Pacific Ocean",
    walletAddress: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP",
    goalXLM: "100000",
    raisedXLM: "31800",
    donorCount: 208,
    co2OffsetKg: 85000,
    status: "active",
    verified: true,
    onChainVerified: false,
    tags: ["ocean", "plastic", "recycling", "cleanup"],
    createdAt: new Date(now - 45 * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  },
  {
    id: "b96391fc-a30e-4435-a875-a8f081395f6e",
    name: "Clean Water Wells - Sub-Saharan Africa",
    description:
      "Drilling and maintaining clean water wells for rural communities in Mali and Niger, reducing the need to boil water over wood fires - saving forests and preventing CO2 emissions.",
    category: "Clean Water",
    location: "Mali & Niger, West Africa",
    walletAddress: "GBSJ7KFU2NXACVHVN2VWIMFZQMQM4NJJ7NKFRRL2GWWI5EKWGYNIFZ7",
    goalXLM: "30000",
    raisedXLM: "24100",
    donorCount: 186,
    co2OffsetKg: 120000,
    status: "active",
    verified: false,
    onChainVerified: false,
    tags: ["water", "africa", "community", "health"],
    createdAt: new Date(now - 20 * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  },
];

const seedProjectUpdates = [
  {
    id: "0a819e07-fc5d-434d-a437-d9808b90cab3",
    projectId: seedProjects[0].id,
    title: "5,000 trees planted in first month!",
    body: "Thanks to donations from our incredible community, we have already planted 5,000 native trees in the Para state. The saplings are thriving and local families are being trained as forest stewards. Thank you to every donor who made this possible.",
    createdAt: new Date(now - 5 * 86400000).toISOString(),
  },
];

/** Sample escrow job — `id` must match the on-chain `job_id` passed to create_job when funding. */
const seedJobs = [
  {
    id: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
    title: "Climate dashboard UI",
    description:
      "Build a responsive analytics dashboard for our NGO. Funds are held in escrow until you approve the delivered work.",
    clientPublicKey: "GBVNQON4MFVGJXK5WT7VQJJZXFVHZJB6BHFWJCW7OF5BLNGOLZJQHIY",
    freelancerPublicKey: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP",
    amountEscrowXlm: "50.0000000",
    status: "in_escrow",
    createdAt: new Date(now - 3 * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  },
];

const BADGE_THRESHOLDS = [
  { tier: "earth", min: 2000 },
  { tier: "forest", min: 500 },
  { tier: "tree", min: 100 },
  { tier: "seedling", min: 10 },
];

function computeBadges(totalXLM) {
  const earned = [];
  for (const badge of BADGE_THRESHOLDS) {
    if (totalXLM >= badge.min) {
      earned.push({ tier: badge.tier, earnedAt: new Date().toISOString() });
      break;
    }
  }
  return earned;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function mapProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    location: row.location,
    walletAddress: row.wallet_address,
    goalXLM: row.goal_xlm?.toString() || "0",
    raisedXLM: row.raised_xlm?.toString() || "0",
    donorCount: row.donor_count,
    co2OffsetKg: row.co2_offset_kg,
    status: row.status,
    verified: row.verified,
    onChainVerified: row.on_chain_verified,
    tags: row.tags || [],
    aiSummary:            row.ai_summary || null,
    aiSummaryGeneratedAt: row.ai_summary_generated_at ? toIso(row.ai_summary_generated_at) : null,
    aiSummaryModel:       row.ai_summary_model || null,
    aiSummarySourceHash:  row.ai_summary_source_hash || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapDonationRow(row) {
  const data = {
    id: row.id,
    projectId: row.project_id,
    donorAddress: row.donor_address,
    amount: row.amount?.toString() || "0",
    currency: row.currency,
    message: row.message,
    transactionHash: row.transaction_hash,
    createdAt: toIso(row.created_at),
  };

  if (row.amount_xlm !== null && row.amount_xlm !== undefined) {
    data.amountXLM = Number.parseFloat(row.amount_xlm).toFixed(7);
  }

  return data;
}

function mapProfileRow(row) {
  return {
    publicKey: row.public_key,
    displayName: row.display_name,
    bio: row.bio,
    totalDonatedXLM: row.total_donated_xlm?.toString() || "0",
    projectsSupported: row.projects_supported,
    badges: row.badges || [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapProjectUpdateRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    createdAt: toIso(row.created_at),
  };
}

function mapJobRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    clientPublicKey: row.client_public_key,
    freelancerPublicKey: row.freelancer_public_key,
    amountEscrowXlm: row.amount_escrow_xlm?.toString() || "0",
    status: row.status,
    releaseTransactionHash: row.release_transaction_hash || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapProjectMilestoneRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    percentage: row.percentage,
    title: row.title,
    reachedAt: toIso(row.reached_at),
    transactionHash: row.transaction_hash,
    createdAt: toIso(row.created_at),
  };
}

function mapProjectRatingRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    donorAddress: row.donor_address,
    rating: row.rating,
    review: row.review,
    createdAt: toIso(row.created_at),
  };
}

module.exports = {
  seedProjects,
  seedProjectUpdates,
  seedJobs,
  BADGE_THRESHOLDS,
  computeBadges,
  mapProjectRow,
  mapDonationRow,
  mapProfileRow,
  mapProjectUpdateRow,
  mapJobRow,
  mapProjectMilestoneRow,
  mapProjectRatingRow,
};
