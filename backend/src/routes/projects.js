/**
 * src/routes/projects.js
 */
"use strict";
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const { mapProjectRow, mapProjectMilestoneRow } = require("../services/store");
const { getOnChainProject, CONTRACT_ID, server, NETWORK_PASSPHRASE } = require("../services/stellar");
const { generateProjectSummary } = require("../services/claude");
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

function mapCampaignRow(row) {
  const now = Date.now();
  const goalXLM = Number.parseFloat(row.goal_xlm?.toString() || "0");
  const raisedXLM = Number.parseFloat(row.raised_xlm?.toString() || "0");
  const deadlineMs = new Date(row.deadline).getTime();
  const completed = raisedXLM >= goalXLM || now >= deadlineMs;
  const progressPercent = goalXLM > 0 ? Math.min(Math.round((raisedXLM / goalXLM) * 100), 100) : 0;

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description || "",
    goalXLM: row.goal_xlm?.toString() || "0",
    raisedXLM: raisedXLM.toFixed(7),
    deadline: new Date(row.deadline).toISOString(),
    progressPercent,
    completed,
    active: !completed,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function fetchCampaignsForProject(projectId) {
  const result = await pool.query(
    `SELECT c.*,
            COALESCE(
              SUM(
                CASE
                  WHEN d.currency = 'XLM' THEN d.amount_xlm
                  ELSE 0
                END
              ),
              0
            ) AS raised_xlm
     FROM project_campaigns c
     LEFT JOIN donations d
       ON d.project_id = c.project_id
      AND d.created_at >= c.created_at
      AND d.created_at <= c.deadline
     WHERE c.project_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [projectId],
  );
  return result.rows.map(mapCampaignRow);
}

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
    const projectId = req.params.id;
    const onChainProject = await getOnChainProject(projectId);

    const stroopsToXlm = (stroops) => {
      if (stroops === null || stroops === undefined) return "0.0000000";
      let value;
      try {
        value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
      } catch {
        return "0.0000000";
      }
      const negative = value < 0n;
      if (negative) value = -value;
      const whole = value / 10000000n;
      const frac = value % 10000000n;
      const fracStr = frac.toString().padStart(7, "0");
      return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`;
    };

    res.json({
      success: true,
      data: {
        projectId,
        onChainVerified: Boolean(onChainProject),
        contractRegisteredAt: onChainProject ? Number(onChainProject.registered_at) : null,
        totalRaisedOnChain: onChainProject ? stroopsToXlm(onChainProject.total_raised) : "0.0000000",
      },
    });
  } catch (err) {
    res.json({
      success: true,
      data: {
        projectId: req.params.id,
        onChainVerified: false,
        contractRegisteredAt: null,
        totalRaisedOnChain: "0.0000000",
      },
    });
  }
});

router.post("/:id/campaigns", async (req, res, next) => {
  try {
    const { title, goalXLM, deadline, description } = req.body || {};
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedDescription = typeof description === "string" ? description.trim() : "";
    const goal = Number.parseFloat(goalXLM);
    const deadlineDate = new Date(deadline);

    if (trimmedTitle.length < 3 || trimmedTitle.length > 120) {
      return res.status(400).json({ error: "title must be between 3 and 120 characters" });
    }
    if (!Number.isFinite(goal) || goal <= 0) {
      return res.status(400).json({ error: "goalXLM must be a positive number" });
    }
    if (!deadline || Number.isNaN(deadlineDate.getTime())) {
      return res.status(400).json({ error: "deadline must be a valid ISO date string" });
    }
    if (deadlineDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: "deadline must be in the future" });
    }
    if (trimmedDescription.length > 500) {
      return res.status(400).json({ error: "description must be 500 characters or fewer" });
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result = await pool.query(
      `INSERT INTO project_campaigns (id, project_id, title, description, goal_xlm, deadline, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *, 0::numeric AS raised_xlm`,
      [uuid(), req.params.id, trimmedTitle, trimmedDescription || null, goal.toFixed(7), deadlineDate.toISOString()],
    );

    res.status(201).json({ success: true, data: mapCampaignRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/campaigns", async (req, res, next) => {
  try {
    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }
    const campaigns = await fetchCampaignsForProject(req.params.id);
    res.json({ success: true, data: campaigns });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/milestones", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [req.params.id],
    );
    res.json({ success: true, data: result.rows.map(mapProjectMilestoneRow) });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/milestones", async (req, res, next) => {
  try {
    const { title, percentage } = req.body;
    if (!title || typeof percentage !== "number") {
      return res.status(400).json({ error: "title and percentage (number) are required" });
    }
    const result = await pool.query(
      `INSERT INTO project_milestones (id, project_id, title, percentage)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [uuid(), req.params.id, title, percentage],
    );
    res.status(201).json({ success: true, data: mapProjectMilestoneRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/milestones/:milestoneId/reach", async (req, res, next) => {
  try {
    const { transactionHash } = req.body;
    const result = await pool.query(
      `UPDATE project_milestones
       SET reached_at = NOW(), transaction_hash = $1
       WHERE id = $2 AND project_id = $3
       RETURNING *`,
      [transactionHash || null, req.params.milestoneId, req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Milestone not found" });
    res.json({ success: true, data: mapProjectMilestoneRow(result.rows[0]) });
  } catch (e) {
    next(e);
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
    const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) return res.status(404).json({ error: "Project not found" });
    const campaigns = await fetchCampaignsForProject(req.params.id);
    const onChainProject = await getOnChainProject(req.params.id);

    // Fetch average rating
    const ratingResult = await pool.query(
      "SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM project_ratings WHERE project_id = $1",
      [req.params.id],
    );

    // Fetch milestones
    const milestoneResult = await pool.query(
      "SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [req.params.id],
    );

    const stroopsToXlm = (stroops) => {
      if (stroops === null || stroops === undefined) return "0.0000000";
      let value;
      try {
        value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
      } catch {
        return "0.0000000";
      }
      const negative = value < 0n;
      if (negative) value = -value;
      const whole = value / 10000000n;
      const frac = value % 10000000n;
      const fracStr = frac.toString().padStart(7, "0");
      return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`;
    };

    res.json({
      success: true,
      data: {
        ...mapProjectRow(projectResult.rows[0]),
        onChainVerified: Boolean(onChainProject) || Boolean(projectResult.rows[0].on_chain_verified),
        contractRegisteredAt: onChainProject ? Number(onChainProject.registered_at) : null,
        totalRaisedOnChain: onChainProject ? stroopsToXlm(onChainProject.total_raised) : "0.0000000",
        campaigns,
        activeCampaign: campaigns.find((campaign) => campaign.active) || null,
        averageRating: parseFloat(ratingResult.rows[0].avg_rating) || 0,
        ratingCount: parseInt(ratingResult.rows[0].count) || 0,
        milestones: milestoneResult.rows.map(mapProjectMilestoneRow),
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/projects/:id/generate-summary
 *
 * Generates (or regenerates) a 3-sentence donor-facing impact summary using
 * the Claude API and caches it on the project record. Body:
 *
 *   { adminAddress: "G..." }   // must equal projects.wallet_address
 *
 * Mirrors the admin-page convention (`isOwner = publicKey === walletAddress`)
 * so only the project owner can spend Anthropic API credits on their project.
 *
 * Response: { success: true, data: { aiSummary, aiSummaryGeneratedAt,
 *                                    aiSummaryModel, aiSummarySourceHash } }
 */
router.post("/:id/generate-summary", async (req, res, next) => {
  try {
    const { adminAddress } = req.body || {};
    if (!adminAddress || typeof adminAddress !== "string") {
      return res.status(400).json({ error: "adminAddress is required" });
    }

    const projectResult = await pool.query(
      "SELECT id, name, category, description, wallet_address FROM projects WHERE id = $1",
      [req.params.id],
    );
    const project = projectResult.rows[0];
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.wallet_address !== adminAddress) {
      return res.status(403).json({ error: "Only the project owner can generate a summary" });
    }

    let summaryResult;
    try {
      summaryResult = await generateProjectSummary({
        name: project.name,
        category: project.category,
        description: project.description,
      });
    } catch (err) {
      if (err.code === "MISSING_API_KEY") {
        return res.status(503).json({ error: "AI summary feature is not configured on this server" });
      }
      // Surface upstream Anthropic errors with their HTTP status when available
      // so the client can distinguish 429 (rate-limited) from 5xx (retry later).
      const status = err.status && Number.isInteger(err.status) ? err.status : 502;
      return res.status(status).json({ error: err.message || "Failed to generate summary" });
    }

    const sourceHash = crypto
      .createHash("sha256")
      .update(project.description || "")
      .digest("hex");

    const updated = await pool.query(
      `UPDATE projects
          SET ai_summary              = $1,
              ai_summary_generated_at = NOW(),
              ai_summary_model        = $2,
              ai_summary_source_hash  = $3,
              updated_at              = NOW()
        WHERE id = $4
        RETURNING ai_summary, ai_summary_generated_at, ai_summary_model, ai_summary_source_hash`,
      [summaryResult.summary, summaryResult.model, sourceHash, req.params.id],
    );

    const row = updated.rows[0];
    res.json({
      success: true,
      data: {
        aiSummary:            row.ai_summary,
        aiSummaryGeneratedAt: new Date(row.ai_summary_generated_at).toISOString(),
        aiSummaryModel:       row.ai_summary_model,
        aiSummarySourceHash:  row.ai_summary_source_hash,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/matching", async (req, res, next) => {
  try {
    const { matcherAddress, capXLM, multiplier, expiresAt } = req.body || {};

    if (!matcherAddress || typeof matcherAddress !== "string") {
      return res.status(400).json({ error: "matcherAddress is required" });
    }
    if (!capXLM || isNaN(Number.parseFloat(capXLM)) || Number.parseFloat(capXLM) <= 0) {
      return res.status(400).json({ error: "capXLM must be a positive number" });
    }
    if (!multiplier || typeof multiplier !== "number" || multiplier < 1) {
      return res.status(400).json({ error: "multiplier must be >= 1" });
    }
    if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
      return res.status(400).json({ error: "expiresAt must be a valid ISO date string" });
    }
    if (new Date(expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: "expiresAt must be in the future" });
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result = await pool.query(
      `INSERT INTO donation_matches (id, project_id, matcher_address, cap_xlm, multiplier, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, matcher_address, cap_xlm, multiplier, matched_xlm, expires_at, created_at`,
      [uuid(), req.params.id, matcherAddress, Number.parseFloat(capXLM).toFixed(7), multiplier, new Date(expiresAt).toISOString()],
    );

    const row = result.rows[0];
    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        projectId: row.project_id,
        matcherAddress: row.matcher_address,
        capXLM: row.cap_xlm?.toString() || "0",
        multiplier: row.multiplier,
        matchedXLM: row.matched_xlm?.toString() || "0",
        expiresAt: new Date(row.expires_at).toISOString(),
        createdAt: new Date(row.created_at).toISOString(),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/matching", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, project_id, matcher_address, cap_xlm, multiplier, matched_xlm, expires_at, created_at
       FROM donation_matches
       WHERE project_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [req.params.id],
    );

    const matches = result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      matcherAddress: row.matcher_address,
      capXLM: row.cap_xlm?.toString() || "0",
      multiplier: row.multiplier,
      matchedXLM: row.matched_xlm?.toString() || "0",
      remainingXLM: (Number.parseFloat(row.cap_xlm) - Number.parseFloat(row.matched_xlm)).toFixed(7),
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    }));

    res.json({ success: true, data: matches });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
