/**
 * src/routes/projects.js
 */
"use strict";
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const QRCode = require("qrcode");
const pool = require("../db/pool");
const { logAdminAction } = require("../services/audit");
const { mapProjectRow, mapProjectMilestoneRow } = require("../services/store");
const { getOnChainProject, CONTRACT_ID, server, NETWORK_PASSPHRASE } = require("../services/stellar");
const { enqueueAISummary } = require("../services/summaryQueue");
const { Contract, TransactionBuilder } = require("@stellar/stellar-sdk");
const redis = require("../services/redis");

const PROJECTS_LIST_CACHE_TTL = 60; // seconds
const PROJECTS_LIST_CACHE_PREFIX = "projects:list:";

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
    const { category, status, verified, search, limit = 20, cursor } = req.query;
    const pageSize = Math.min(Number.parseInt(limit, 10) || 20, 100);

    const cacheKey = PROJECTS_LIST_CACHE_PREFIX + JSON.stringify({ category, status, verified, search, limit: pageSize, cursor: cursor || null });
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

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

    if (cursor) {
      let cursorData;
      try {
        cursorData = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      const { created_at, id } = cursorData;
      if (!created_at || !id) {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      values.push(created_at, id);
      const caIdx = values.length - 1;
      const idIdx = values.length;
      where.push(`(created_at < $${caIdx} OR (created_at = $${caIdx} AND id < $${idIdx}))`);
    }

    values.push(pageSize + 1);
    const limitIdx = values.length;

    let query = "SELECT * FROM projects ";
    if (where.length) {
      query += "WHERE " + where.join(" AND ") + " ";
    }
    query += `ORDER BY created_at DESC, id DESC LIMIT $${limitIdx}`;

    // All user-controlled values (status, category, search, cursor fields) are
    // passed as parameterised $N placeholders in `values`. Dynamic WHERE clauses
    // are built only from whitelisted enum strings, so no injection surface exists.
    const result = await pool.query(query, values);
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const data = rows.slice(0, pageSize).map(mapProjectRow);

    let nextCursor = null;
    if (hasMore) {
      const last = rows[pageSize - 1];
      nextCursor = Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64");
    }

    const responseBody = { success: true, data, next_cursor: nextCursor, has_more: hasMore };
    await redis.set(cacheKey, responseBody, PROJECTS_LIST_CACHE_TTL);

    res.json(responseBody);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/projects
 * Create a new project. Validates string lengths to prevent database bloat.
 */
router.post("/", async (req, res, next) => {
  try {
    const { name, description, location, category, wallet_address, goal_xlm = 0, tags = [] } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length < 3 || name.trim().length > 120) {
      return res.status(400).json({ error: "name must be between 3 and 120 characters" });
    }
    if (!description || typeof description !== "string" || description.trim().length < 10 || description.trim().length > 5000) {
      return res.status(400).json({ error: "description must be between 10 and 5000 characters" });
    }
    if (!location || typeof location !== "string" || location.trim().length < 2 || location.trim().length > 200) {
      return res.status(400).json({ error: "location must be between 2 and 200 characters" });
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }
    if (!wallet_address || typeof wallet_address !== "string") {
      return res.status(400).json({ error: "wallet_address is required" });
    }

    const id = uuid();
    const result = await pool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, name.trim(), description.trim(), category, location.trim(), wallet_address, goal_xlm, tags],
    );

    await redis.deletePattern(PROJECTS_LIST_CACHE_PREFIX + "*");
    res.status(201).json({ success: true, data: mapProjectRow(result.rows[0]) });
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

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.campaign.create",
      targetType: "project_campaign",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, title: trimmedTitle, goalXLM: goal, deadline },
      ipAddress: req.ip,
    });

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

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.milestone.create",
      targetType: "project_milestone",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, title, percentage },
      ipAddress: req.ip,
    });

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

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.milestone.reach",
      targetType: "project_milestone",
      targetId: req.params.milestoneId,
      metadata: { projectId: req.params.id, transactionHash },
      ipAddress: req.ip,
    });

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
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("register_project", adminAddress, projectId, name, wallet, parseInt(co2PerXLM)))
      .setTimeout(30)
      .build();

    logAdminAction({
      actor: adminAddress,
      action: "project.register",
      targetType: "project",
      targetId: projectId,
      metadata: { name, wallet, co2PerXLM },
      ipAddress: req.ip,
    });

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

    logAdminAction({
      actor: "admin",
      action: "project.confirm",
      targetType: "project",
      targetId: projectId,
      metadata: { transactionHash },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: result.rows[0] ? mapProjectRow(result.rows[0]) : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) return res.status(404).json({ error: "Project not found" });

    const updatedAt = projectResult.rows[0].updated_at;
    const etag = `"${crypto.createHash("md5").update(String(updatedAt)).digest("hex")}"`;
    const lastModified = new Date(updatedAt).toUTCString();
    res.set("ETag", etag);
    res.set("Last-Modified", lastModified);
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

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

    await enqueueAISummary(req.params.id, {
      name: project.name,
      category: project.category,
      description: project.description,
      adminAddress,
    });

    logAdminAction({
      actor: adminAddress,
      action: "project.summary.enqueued",
      targetType: "project",
      targetId: req.params.id,
      metadata: {},
      ipAddress: req.ip,
    });

    res.status(202).json({ success: true, data: { status: "queued" } });
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

    logAdminAction({
      actor: matcherAddress,
      action: "project.matching.create",
      targetType: "donation_match",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, capXLM, multiplier, expiresAt },
      ipAddress: req.ip,
    });

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

/**
 * PATCH /api/projects/:id/status
 * Approve or reject a project. Body: { status: "active" | "rejected", reason?: string }
 * `adminAddress` must match the project wallet (owner) or be a platform admin.
 */
router.patch("/:id/status", async (req, res, next) => {
  try {
    const { status, reason, adminAddress } = req.body || {};
    const validStatuses = ["active", "rejected", "paused"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result = await pool.query(
      `UPDATE projects
       SET status = $1,
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, reason || null, req.params.id],
    );

    logAdminAction({
      actor: adminAddress || "unknown",
      action: `project.status.${status}`,
      targetType: "project",
      targetId: req.params.id,
      metadata: { previousStatus: projectResult.rows[0].status, reason },
      ipAddress: req.ip,
    });

    await redis.deletePattern(PROJECTS_LIST_CACHE_PREFIX + "*");

    res.json({ success: true, data: mapProjectRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

// ── Impact certificate ─────────────────────────────────────────────────────

/**
 * GET /api/projects/:id/impact-certificate?donorAddress=G...
 *
 * Returns a personalised impact certificate for a specific donor on a specific
 * project. Includes:
 *   - Donor name (from their profile, if set)
 *   - Total XLM donated to this project
 *   - Total CO₂ offset in kg (proportional to the project's overall offset)
 *   - Trees equivalent
 *   - Badge tier (bronze / silver / gold / platinum)
 *   - Project name, category, and verification status
 *   - QR code (base64 data-URL) linking to the most recent on-chain donation
 *   - Full donation history for this donor on this project
 *
 * Query params:
 *   donorAddress  (required) — Stellar G… public key of the donor
 *
 * Response 200:
 * {
 *   success: true,
 *   data: {
 *     projectId: string,
 *     projectName: string,
 *     projectCategory: string,
 *     projectVerified: boolean,
 *     donorAddress: string,
 *     donorName: string | null,
 *     totalDonatedXLM: string,      // 7-decimal string
 *     co2OffsetKg: number,
 *     treesEquivalent: number,
 *     badgeTier: "bronze"|"silver"|"gold"|"platinum"|null,
 *     donationCount: number,
 *     donations: Array<{
 *       id, amountXLM, message, transactionHash, createdAt
 *     }>,
 *     qrCode: string,               // data:image/png;base64,... for the on-chain record URL
 *     issuedAt: string              // ISO timestamp
 *   }
 * }
 *
 * Errors: 400 (missing/invalid donorAddress), 404 (project or donor not found)
 */

const KG_CO2_PER_TREE_CERT = 21.77; // consistent with impact.js

/** Derive a badge tier from the donor's total XLM donated to this project. */
function deriveBadgeTier(totalXLM) {
  if (totalXLM >= 10000) return "platinum";
  if (totalXLM >= 1000) return "gold";
  if (totalXLM >= 100) return "silver";
  if (totalXLM > 0) return "bronze";
  return null;
}

/**
 * Build the URL to the on-chain donation record on Stellar Explorer.
 * Falls back to the Horizon testnet explorer.
 */
function buildOnChainUrl(transactionHash) {
  const network = process.env.STELLAR_NETWORK || "testnet";
  if (network === "mainnet" || network === "public") {
    return `https://stellar.expert/explorer/public/tx/${transactionHash}`;
  }
  return `https://stellar.expert/explorer/testnet/tx/${transactionHash}`;
}

router.get("/:id/impact-certificate", async (req, res, next) => {
  try {
    const { donorAddress } = req.query;

    // Validate donorAddress — must be a 56-char Stellar G-address
    if (
      !donorAddress ||
      typeof donorAddress !== "string" ||
      !/^G[A-Z2-7]{55}$/.test(donorAddress)
    ) {
      return res.status(400).json({
        error: "donorAddress query parameter is required and must be a valid Stellar public key",
      });
    }

    // 1. Fetch project — now includes category and verification status
    const projectResult = await pool.query(
      `SELECT id, name, category, verified, on_chain_verified, raised_xlm, co2_offset_kg
       FROM projects
       WHERE id = $1`,
      [req.params.id],
    );
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    // 2. Fetch donor's profile (display name) — may not exist
    const profileResult = await pool.query(
      "SELECT display_name FROM profiles WHERE public_key = $1",
      [donorAddress],
    );

    // 3. Fetch all XLM donations by this donor for this project
    const donationsResult = await pool.query(
      `SELECT
         id,
         COALESCE(amount_xlm, amount) AS amount_xlm,
         message,
         transaction_hash,
         created_at
       FROM donations
       WHERE project_id = $1
         AND donor_address = $2
         AND (currency = 'XLM' OR currency IS NULL)
       ORDER BY created_at DESC`,
      [req.params.id, donorAddress],
    );

    if (donationsResult.rows.length === 0) {
      return res.status(404).json({
        error: "No donations found for this donor on this project",
      });
    }

    // 4. Compute aggregate stats
    const project = projectResult.rows[0];
    const raisedXlm = Number.parseFloat(project.raised_xlm?.toString() || "0");
    const projectCo2Kg = Number.parseFloat(project.co2_offset_kg?.toString() || "0");
    const kgPerXlm = raisedXlm > 0 ? projectCo2Kg / raisedXlm : 0;

    const totalDonatedXLM = donationsResult.rows.reduce(
      (sum, row) => sum + Number.parseFloat(row.amount_xlm?.toString() || "0"),
      0,
    );
    const co2OffsetKg = Math.round(totalDonatedXLM * kgPerXlm);
    const treesEquivalent =
      co2OffsetKg > 0
        ? Number((co2OffsetKg / KG_CO2_PER_TREE_CERT).toFixed(2))
        : 0;

    const donations = donationsResult.rows.map((row) => ({
      id: row.id,
      amountXLM: Number.parseFloat(row.amount_xlm?.toString() || "0").toFixed(7),
      message: row.message || null,
      transactionHash: row.transaction_hash,
      createdAt: new Date(row.created_at).toISOString(),
    }));

    // 5. Generate QR code linking to the most recent on-chain donation record
    const latestTxHash = donationsResult.rows[0].transaction_hash;
    const onChainUrl = buildOnChainUrl(latestTxHash);
    const qrCode = await QRCode.toDataURL(onChainUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    });

    return res.json({
      success: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        projectCategory: project.category,
        projectVerified: Boolean(project.verified) || Boolean(project.on_chain_verified),
        donorAddress,
        donorName: profileResult.rows[0]?.display_name || null,
        totalDonatedXLM: totalDonatedXLM.toFixed(7),
        co2OffsetKg,
        treesEquivalent,
        badgeTier: deriveBadgeTier(totalDonatedXLM),
        donationCount: donations.length,
        donations,
        qrCode,
        issuedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
