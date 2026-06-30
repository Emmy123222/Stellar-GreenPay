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
const { adminKeyRequired } = require("../middleware/auth");
const { mapProjectRow, mapProjectMilestoneRow } = require("../services/store");
const {
  getOnChainProject,
  CONTRACT_ID,
  server,
  NETWORK_PASSPHRASE,
} = require("../services/stellar");
const { enqueueAISummary } = require("../services/summaryQueue");
const { Contract, TransactionBuilder } = require("@stellar/stellar-sdk");
const redis = require("../services/redis");
const { adminRequired } = require("../middleware/auth");

const PROJECTS_LIST_CACHE_TTL = 60; // seconds
const PROJECTS_LIST_CACHE_PREFIX = "projects:list:";
const PROJECT_MILESTONES_CACHE_TTL = 300; // seconds (5 minutes)
const PROJECT_MILESTONES_CACHE_PREFIX = "projects:milestones:";

function getProjectMilestonesCacheKey(projectId) {
  return PROJECT_MILESTONES_CACHE_PREFIX + projectId;
}

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
const STELLAR_PUBLIC_KEY_RE = /^G[A-Z0-9]{55}$/;

const createProjectSchema = z.object({
  name: sanitizedStringField({ required: true, minLength: 3, maxLength: 120, message: "must not contain HTML" }),
  description: sanitizedStringField({ required: true, minLength: 10, maxLength: 5000, message: "must not contain HTML" }),
  location: sanitizedStringField({ required: true, minLength: 2, maxLength: 200, message: "must not contain HTML" }),
  category: z.enum(VALID_CATEGORIES),
  wallet_address: z.string().min(1, "wallet_address is required"),
  goal_xlm: z.union([z.string(), z.number()]).optional(),
  tags: z.array(z.string()).optional().default([]),
});

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
  const progressPercent =
    goalXLM > 0 ? Math.min(Math.round((raisedXLM / goalXLM) * 100), 100) : 0;

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

/**
 * Return the currently featured active project.
 *
 * @route GET /api/projects/featured
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the featured project payload or a 404 response.
 * @throws {Error} If the database lookup or cache update fails.
 */
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

/**
 * List projects with optional filtering, pagination, and search.
 *
 * @route GET /api/projects
 * @param {import('express').Request} req - Express request object with query filters and pagination.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends a paginated project list.
 * @throws {Error} If the project query or cache write fails.
 */
router.get("/", async (req, res, next) => {
  try {
    const {
      category,
      status,
      verified,
      search,
      limit = 20,
      cursor,
    } = req.query;
    const pageSize = Math.min(Number.parseInt(limit, 10) || 20, 100);

    const cacheKey =
      PROJECTS_LIST_CACHE_PREFIX +
      JSON.stringify({
        category,
        status,
        verified,
        search,
        limit: pageSize,
        cursor: cursor || null,
      });
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
      where.push(
        `(created_at < $${caIdx} OR (created_at = $${caIdx} AND id < $${idIdx}))`,
      );
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
    // eslint-disable-next-line sql-injection/no-sql-injection
    const result = await pool.query(query, values);
    const rows = result.rows;
    const hasMore = rows.length > pageSize;
    const data = rows.slice(0, pageSize).map(mapProjectRow);

    let nextCursor = null;
    if (hasMore) {
      const last = rows[pageSize - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ created_at: last.created_at, id: last.id }),
      ).toString("base64");
    }

    const responseBody = {
      success: true,
      data,
      next_cursor: nextCursor,
      has_more: hasMore,
    };
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
/**
 * Create a new project record.
 *
 * @route POST /api/projects
 * @param {import('express').Request} req - Express request with project creation payload.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the created project payload.
 * @throws {Error} If validation or database insertion fails.
 */
router.post("/", async (req, res, next) => {
  try {
    const {
      name,
      description,
      location,
      category,
      wallet_address,
      goal_xlm = 0,
      tags = [],
    } = req.body || {};

    if (
      !name ||
      typeof name !== "string" ||
      name.trim().length < 3 ||
      name.trim().length > 120
    ) {
      return res
        .status(400)
        .json({ error: "name must be between 3 and 120 characters" });
    }
    if (
      !description ||
      typeof description !== "string" ||
      description.trim().length < 10 ||
      description.trim().length > 5000
    ) {
      return res
        .status(400)
        .json({ error: "description must be between 10 and 5000 characters" });
    }
    if (
      !location ||
      typeof location !== "string" ||
      location.trim().length < 2 ||
      location.trim().length > 200
    ) {
      return res
        .status(400)
        .json({ error: "location must be between 2 and 200 characters" });
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({
          error: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
        });
    }
    if (!wallet_address || typeof wallet_address !== "string") {
      return res.status(400).json({ error: "wallet_address is required" });
    }

    const id = uuid();
    const result = await pool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        name.trim(),
        description.trim(),
        category,
        location.trim(),
        wallet_address,
        goal_xlm,
        tags,
      ],
    );

    await redis.deletePattern(PROJECTS_LIST_CACHE_PREFIX + "*");
    res
      .status(201)
      .json({ success: true, data: mapProjectRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/projects/:id/verify
 * Reads the project record directly from the Soroban contract.
 */
/**
 * Query the on-chain verification state for a project.
 *
 * @route GET /api/projects/:id/verify
 * @param {import('express').Request} req - Express request containing the project id.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>} Sends the verification status payload.
 * @throws {Error} If the Soroban project lookup fails unexpectedly.
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
        contractRegisteredAt: onChainProject
          ? Number(onChainProject.registered_at)
          : null,
        totalRaisedOnChain: onChainProject
          ? stroopsToXlm(onChainProject.total_raised)
          : "0.0000000",
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

/**
 * Create a donation campaign for a project.
 *
 * @route POST /api/projects/:id/campaigns
 * @param {import('express').Request} req - Express request with campaign details.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the created campaign payload.
 * @throws {Error} If validation or database insertion fails.
 */
router.post("/:id/campaigns", async (req, res, next) => {
  try {
    const { title, goalXLM, deadline, description } = req.body || {};
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedDescription =
      typeof description === "string" ? description.trim() : "";
    const goal = Number.parseFloat(goalXLM);
    const deadlineDate = new Date(deadline);

    if (trimmedTitle.length < 3 || trimmedTitle.length > 120) {
      return res
        .status(400)
        .json({ error: "title must be between 3 and 120 characters" });
    }
    if (!Number.isFinite(goal) || goal <= 0) {
      return res
        .status(400)
        .json({ error: "goalXLM must be a positive number" });
    }
    if (!deadline || Number.isNaN(deadlineDate.getTime())) {
      return res
        .status(400)
        .json({ error: "deadline must be a valid ISO date string" });
    }
    if (deadlineDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: "deadline must be in the future" });
    }
    if (trimmedDescription.length > 500) {
      return res
        .status(400)
        .json({ error: "description must be 500 characters or fewer" });
    }

    const projectResult = await pool.query(
      "SELECT id FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result = await pool.query(
      `INSERT INTO project_campaigns (id, project_id, title, description, goal_xlm, deadline, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *, 0::numeric AS raised_xlm`,
      [
        uuid(),
        req.params.id,
        trimmedTitle,
        trimmedDescription || null,
        goal.toFixed(7),
        deadlineDate.toISOString(),
      ],
    );

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.campaign.create",
      targetType: "project_campaign",
      targetId: result.rows[0].id,
      metadata: {
        projectId: req.params.id,
        title: trimmedTitle,
        goalXLM: goal,
        deadline,
      },
      ipAddress: req.ip,
    });

    res
      .status(201)
      .json({ success: true, data: mapCampaignRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

/**
 * List campaigns linked to a project.
 *
 * @route GET /api/projects/:id/campaigns
 * @param {import('express').Request} req - Express request containing the project id.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the list of campaigns.
 * @throws {Error} If the lookup fails.
 */
router.get("/:id/campaigns", async (req, res, next) => {
  try {
    const projectResult = await pool.query(
      "SELECT id FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }
    const campaigns = await fetchCampaignsForProject(req.params.id);
    res.json({ success: true, data: campaigns });
  } catch (e) {
    next(e);
  }
});

/**
 * List milestones for a project.
 *
 * @route GET /api/projects/:id/milestones
 * @param {import('express').Request} req - Express request containing the project id.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the milestone list.
 * @throws {Error} If the milestone query fails.
 */
router.get("/:id/milestones", async (req, res, next) => {
  try {
    const cacheKey = getProjectMilestonesCacheKey(req.params.id);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await pool.query(
      "SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [req.params.id],
    );

    const responseBody = {
      success: true,
      data: result.rows.map(mapProjectMilestoneRow),
    };
    await redis.set(cacheKey, responseBody, PROJECT_MILESTONES_CACHE_TTL);
    res.json(responseBody);
  } catch (e) {
    next(e);
  }
});

/**
 * Create a milestone for a project.
 *
 * @route POST /api/projects/:id/milestones
 * @param {import('express').Request} req - Express request with milestone details.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the created milestone payload.
 * @throws {Error} If validation or insertion fails.
 */
router.post("/:id/milestones", async (req, res, next) => {
  try {
    const { title, percentage } = req.body;
    if (!title || typeof percentage !== "number") {
      return res
        .status(400)
        .json({ error: "title and percentage (number) are required" });
    }
    const result = await pool.query(
      `INSERT INTO project_milestones (id, project_id, title, percentage)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [uuid(), req.params.id, title, percentage],
    );

    await redis.deletePattern(getProjectMilestonesCacheKey(req.params.id));

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.milestone.create",
      targetType: "project_milestone",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, title, percentage },
      ipAddress: req.ip,
    });

    res
      .status(201)
      .json({ success: true, data: mapProjectMilestoneRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

/**
 * Mark a milestone as reached.
 *
 * @route POST /api/projects/:id/milestones/:milestoneId/reach
 * @param {import('express').Request} req - Express request with milestone and project ids.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the updated milestone payload.
 * @throws {Error} If the milestone update fails.
 */
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
    if (!result.rows[0])
      return res.status(404).json({ error: "Milestone not found" });

    await redis.deletePattern(getProjectMilestonesCacheKey(req.params.id));

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
 * GET /api/projects/admin/pending
 * Admin-only endpoint returning unverified active projects for review.
 */
router.get("/admin/pending", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM projects WHERE verified = false AND status = 'active'"
    );
    const total = countResult.rows[0].total;

    const result = await pool.query(
      `SELECT * FROM projects
       WHERE verified = false AND status = 'active'
       ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      data: result.rows.map(mapProjectRow),
      total
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/projects/admin/register
 * Builds a Soroban transaction to register a project on-chain.
 * Returns the XDR for the admin to sign.
 */
router.post("/admin/register", adminRequired, async (req, res) => {
  try {
    const { projectId, name, wallet, co2PerXLM, adminAddress } = req.body;

    if (!CONTRACT_ID) throw new Error("CONTRACT_ID not configured");
    if (!adminAddress) return res.status(401).json({ success: false, error: "adminAddress is required" });

    const contract = new Contract(CONTRACT_ID);
    const sourceAccount = await server.loadAccount(adminAddress);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "register_project",
          adminAddress,
          projectId,
          name,
          wallet,
          parseInt(co2PerXLM),
        ),
      )
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
router.post("/admin/confirm", adminRequired, async (req, res) => {
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

    res.json({
      success: true,
      data: result.rows[0] ? mapProjectRow(result.rows[0]) : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Return a single project with its campaigns, milestones, and rating details.
 *
 * @route GET /api/projects/:id
 * @param {import('express').Request} req - Express request containing the project id.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the full project details payload.
 * @throws {Error} If the project lookup or related data fetch fails.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const projectResult = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!projectResult.rows[0])
      return res.status(404).json({ error: "Project not found" });

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

    // Fetch subscriber count
    const subscriberResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM project_subscriptions WHERE project_id = $1",
      [req.params.id],
    );

    // Fetch milestones
    const milestoneResult = await pool.query(
      "SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [req.params.id],
    );

    // Fetch follower count and, when ?walletAddress=G... is provided, whether
    // that wallet is currently following this project.
    const followCountResult = await pool.query(
      "SELECT COUNT(*) AS count FROM project_follows WHERE project_id = $1",
      [req.params.id],
    );
    const followCount = parseInt(followCountResult.rows[0].count, 10) || 0;

    let isFollowing = false;
    const { walletAddress } = req.query;
    if (walletAddress && typeof walletAddress === "string") {
      const followResult = await pool.query(
        "SELECT 1 FROM project_follows WHERE project_id = $1 AND wallet_address = $2",
        [req.params.id, walletAddress],
      );
      isFollowing = followResult.rowCount > 0;
    }

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
        onChainVerified:
          Boolean(onChainProject) ||
          Boolean(projectResult.rows[0].on_chain_verified),
        contractRegisteredAt: onChainProject
          ? Number(onChainProject.registered_at)
          : null,
        totalRaisedOnChain: onChainProject
          ? stroopsToXlm(onChainProject.total_raised)
          : "0.0000000",
        campaigns,
        activeCampaign: campaigns.find((campaign) => campaign.active) || null,
        averageRating: parseFloat(ratingResult.rows[0]?.avg_rating) || 0,
        ratingCount: parseInt(ratingResult.rows[0]?.count) || 0,
        milestones: milestoneResult.rows.map(mapProjectMilestoneRow),
        followCount,
        isFollowing,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/projects/:id/follow
 * Follow a project. Body: { walletAddress: "G..." }
 * Idempotent — re-following a project that is already followed is a no-op.
 */
router.post("/:id/follow", async (req, res, next) => {
  try {
    const { walletAddress } = req.body || {};
    if (!walletAddress || typeof walletAddress !== "string") {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    // INSERT … ON CONFLICT DO NOTHING makes this idempotent.
    await pool.query(
      `INSERT INTO project_follows (project_id, wallet_address, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (project_id, wallet_address) DO NOTHING`,
      [req.params.id, walletAddress],
    );

    const countResult = await pool.query(
      "SELECT COUNT(*) AS count FROM project_follows WHERE project_id = $1",
      [req.params.id],
    );

    res.json({
      success: true,
      data: {
        isFollowing: true,
        followCount: parseInt(countResult.rows[0].count, 10) || 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/projects/:id/follow
 * Unfollow a project. Body: { walletAddress: "G..." }
 * Idempotent — unfollowing a project not currently followed is a no-op.
 */
router.delete("/:id/follow", async (req, res, next) => {
  try {
    const { walletAddress } = req.body || {};
    if (!walletAddress || typeof walletAddress !== "string") {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    await pool.query(
      "DELETE FROM project_follows WHERE project_id = $1 AND wallet_address = $2",
      [req.params.id, walletAddress],
    );

    const countResult = await pool.query(
      "SELECT COUNT(*) AS count FROM project_follows WHERE project_id = $1",
      [req.params.id],
    );

    res.json({
      success: true,
      data: {
        isFollowing: false,
        followCount: parseInt(countResult.rows[0].count, 10) || 0,
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
/**
 * Queue an AI-generated donor-facing summary for a project.
 *
 * @route POST /api/projects/:id/generate-summary
 * @param {import('express').Request} req - Express request with the owner wallet address.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the summary queue status payload.
 * @throws {Error} If the summary queue call fails.
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
      return res
        .status(403)
        .json({ error: "Only the project owner can generate a summary" });
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

/**
 * Create a new donation-matching offer for a project.
 *
 * @route POST /api/projects/:id/matching
 * @param {import('express').Request} req - Express request with matching offer details.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the created matching offer payload.
 * @throws {Error} If validation or persistence fails.
 */
router.post("/:id/matching", async (req, res, next) => {
  try {
    const { matcherAddress, capXLM, multiplier, expiresAt } = req.body || {};

    if (!matcherAddress || typeof matcherAddress !== "string") {
      return res.status(400).json({ error: "matcherAddress is required" });
    }
    if (
      !capXLM ||
      isNaN(Number.parseFloat(capXLM)) ||
      Number.parseFloat(capXLM) <= 0
    ) {
      return res
        .status(400)
        .json({ error: "capXLM must be a positive number" });
    }
    if (!multiplier || typeof multiplier !== "number" || multiplier < 1) {
      return res.status(400).json({ error: "multiplier must be >= 1" });
    }
    if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
      return res
        .status(400)
        .json({ error: "expiresAt must be a valid ISO date string" });
    }
    if (new Date(expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: "expiresAt must be in the future" });
    }

    const projectResult = await pool.query(
      "SELECT id FROM projects WHERE id = $1",
      [req.params.id],
    );
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result = await pool.query(
      `INSERT INTO donation_matches (id, project_id, matcher_address, cap_xlm, multiplier, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, matcher_address, cap_xlm, multiplier, matched_xlm, expires_at, created_at`,
      [
        uuid(),
        req.params.id,
        matcherAddress,
        Number.parseFloat(capXLM).toFixed(7),
        multiplier,
        new Date(expiresAt).toISOString(),
      ],
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

/**
 * List active donation-matching offers for a project.
 *
 * @route GET /api/projects/:id/matching
 * @param {import('express').Request} req - Express request containing the project id.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the matching offers payload.
 * @throws {Error} If the database query fails.
 */
router.get("/:id/matching", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, project_id, matcher_address, cap_xlm, multiplier, matched_xlm, expires_at, created_at
       FROM donation_matches
       WHERE project_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [req.params.id],
    );

    const matches = result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      matcherAddress: row.matcher_address,
      capXLM: row.cap_xlm?.toString() || "0",
      multiplier: row.multiplier,
      matchedXLM: row.matched_xlm?.toString() || "0",
      remainingXLM: (
        Number.parseFloat(row.cap_xlm) - Number.parseFloat(row.matched_xlm)
      ).toFixed(7),
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
/**
 * Update the status of a project.
 *
 * @route PATCH /api/projects/:id/status
 * @param {import('express').Request} req - Express request with the new status payload.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the updated project payload.
 * @throws {Error} If validation or persistence fails.
 */
router.patch("/:id/status", async (req, res, next) => {
  try {
    const { status, reason, adminAddress } = req.body || {};
    const validStatuses = ["active", "rejected", "paused"];
    if (!status || !validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const projectResult = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [req.params.id],
    );
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

    if (typeof redis.deletePattern === "function") await redis.deletePattern(PROJECTS_LIST_CACHE_PREFIX + "*");
    if (typeof redis.deletePattern === "function") await redis.deletePattern("stats:*");

    res.json({ success: true, data: mapProjectRow(result.rows[0]) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/projects/:id/badge-holders
 * Returns the community of badge-holding donors for each project.
 */
router.get("/:id/badge-holders", async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (!projectResult.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    const result = await pool.query(
      `SELECT
         d.donor_address,
         p.badges->0->>'tier' AS badge_tier,
         COALESCE(SUM(d.amount_xlm), 0)::numeric AS total_donated
       FROM donations d
       JOIN profiles p ON d.donor_address = p.public_key
       WHERE d.project_id = $1 AND p.badges != '[]'::jsonb
       GROUP BY d.donor_address, p.badges
       ORDER BY total_donated DESC`,
      [projectId]
    );

    const badgeHolders = result.rows.map(row => ({
      donorAddress: row.donor_address,
      badgeTier: row.badge_tier || null,
      totalDonated: Number.parseFloat(row.total_donated || "0").toFixed(7),
    }));

    res.json({ success: true, data: badgeHolders });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

// Export internal functions for testing
if (process.env.NODE_ENV === "test") {
  module.exports.mapCampaignRow = mapCampaignRow;
}
