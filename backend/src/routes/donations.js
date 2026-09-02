/**
 * src/routes/donations.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const EventEmitter = require("events");
const { v4: uuid } = require("uuid");
const { z } = require("zod");
const geoip = require("geoip-lite");
const logger = require("../logger");
const pool = require("../db/pool");
const redis = require("../services/redis");
const { invalidateProjectImpactCache } = require("./impact");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { computeBadges, mapDonationRow } = require("../services/store");
const { server } = require("../services/stellar");
const donationEvents = require("../services/donationEvents");
const { enqueueProfileUpdate } = require("../services/profileQueue");
const donationLimiter = createRateLimiter(10, 1, "donations"); // 10 requests per minute

function resolveDonorCountry(ip) {
  if (!ip || typeof ip !== "string") return null;
  const normalizedIp = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const geo = geoip.lookup(normalizedIp);
  return geo?.country || null;
}

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) { const e = new Error("Invalid Stellar public key"); e.status = 400; throw e; }
}

function validateTxHash(h) {
  if (!h || !/^[a-fA-F0-9]{64}$/.test(h)) { const e = new Error("Invalid transaction hash"); e.status = 400; throw e; }
}

/**
 * Record a donation after an on-chain transaction is observed.
 *
 * @route POST /api/donations
 * @param {import('express').Request} req - Express request containing the donation payload.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the persisted donation record or an error response.
 * @throws {Error} If validation, project lookup, or donation persistence fails.
 */
async function recordDonation(req, res, next) {
  let client;
  let inTransaction = false;

  try {
    const { projectId, donorAddress, amountXLM, amount, currency = "XLM", message, transactionHash } = req.body;
    const donorCountry = resolveDonorCountry(req.ip);
    validateKey(donorAddress);
    validateTxHash(transactionHash);

    client = await pool.connect();

    const projectResult = await client.query("SELECT id, co2_per_xlm, name FROM projects WHERE id = $1", [projectId]);
    if (!projectResult.rows[0]) { const e = new Error("Project not found"); e.status = 404; throw e; }
    const projectCo2PerXlm = projectResult.rows[0].co2_per_xlm;
    const project = projectResult.rows[0] || {};

    // Determine numeric amount depending on currency
    const parsedAmount = parseFloat(currency === "XLM" ? amountXLM ?? amount : amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) { const e = new Error("Invalid amount"); e.status = 400; throw e; }

    // Deduplicate by tx hash
    const existingResult = await client.query(
      "SELECT * FROM donations WHERE transaction_hash = $1",
      [transactionHash],
    );
    if (existingResult.rows[0]) {
      const existingRow = { ...existingResult.rows[0], co2_per_xlm: projectCo2PerXlm };
      return res.json({ success: true, data: mapDonationRow(existingRow) });
    }

    // Verify the transaction is confirmed on-chain before recording it.
    // Prevents a caller from inflating raised_xlm with a fake or unconfirmed tx hash.
    let onChainTx;
    try {
      onChainTx = await server.getTransaction(transactionHash);
    } catch {
      const e = new Error("Transaction not found on Stellar"); e.status = 400; throw e;
    }
    if (!onChainTx || onChainTx.successful !== true) {
      const e = new Error("Transaction not confirmed on Stellar"); e.status = 400; throw e;
    }

    await client.query("BEGIN");
    inTransaction = true;

    // Calculate previous donated total so we can detect badge tier changes
    const prevTotalResult = await client.query(
      `SELECT COALESCE(SUM(amount_xlm), 0)::numeric AS total
       FROM donations
       WHERE donor_address = $1
         AND amount_xlm IS NOT NULL`,
      [donorAddress],
    );
    const prevTotalDonated = parseFloat(prevTotalResult.rows[0]?.total || "0");
    const newTotalDonated = prevTotalDonated + (currency === "XLM" ? parsedAmount : 0);

    const donationResult = await client.query(
      `INSERT INTO donations (
        id, project_id, donor_address, amount_xlm, amount, currency, message, transaction_hash, donor_country, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *`,
      [
        uuid(),
        projectId,
        donorAddress,
        currency === "XLM" ? parsedAmount : null,
        parsedAmount,
        currency,
        message?.trim().slice(0, 100) || null,
        transactionHash,
        donorCountry,
      ],
    );

    const recordedDonation = donationResult.rows[0] || {
      id: uuid(),
      project_id: projectId,
      donor_address: donorAddress,
      amount_xlm: currency === "XLM" ? parsedAmount : null,
      amount: parsedAmount,
      currency,
      message: message?.trim().slice(0, 100) || null,
      transaction_hash: transactionHash,
      created_at: new Date().toISOString(),
    };

    // Check for active matching offers
    if (currency === "XLM") {
      const matchesResult = await client.query(
        `SELECT id, matcher_address, cap_xlm, matched_xlm, multiplier
         FROM donation_matches
         WHERE project_id = $1 AND expires_at > NOW()`,
        [projectId],
      );

      for (const match of matchesResult.rows) {
        const matchedXlm = Number.parseFloat(match.matched_xlm || "0");
        const capXlm = Number.parseFloat(match.cap_xlm);
        const remaining = capXlm - matchedXlm;

        if (remaining > 0) {
          const matchAmount = Math.min(parsedAmount * match.multiplier, remaining);

          await client.query(
            `INSERT INTO donations (
              id, project_id, donor_address, amount_xlm, amount, currency, message, transaction_hash, donor_country, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
              uuid(),
              projectId,
              match.matcher_address,
              matchAmount,
              matchAmount,
              "XLM",
              `Matching donation for donation from ${donorAddress}`,
              `match-${transactionHash}-${match.id}`,
              donorCountry,
            ],
          );

          await client.query(
            "UPDATE donation_matches SET matched_xlm = matched_xlm + $1 WHERE id = $2",
            [matchAmount, match.id],
          );
        }
      }
    }

    // Update project totals
    await client.query(
      `UPDATE projects
       SET raised_xlm = raised_xlm + $1::numeric,
           donor_count = (
             SELECT COUNT(DISTINCT donor_address)
             FROM donations
             WHERE project_id = $2
           ),
           updated_at = NOW()
       WHERE id = $2`,
      [currency === "XLM" ? parsedAmount : 0, projectId],
    );

    await client.query("COMMIT");
    inTransaction = false;

    await redis.deletePattern("projects:list:*");

    enqueueProfileUpdate(donorAddress).catch((err) => {
      logger.error({ event: "profile_update_enqueue_failed", err, donorAddress }, "Failed to enqueue profile update job");
    });

    (req.log || logger).info({
      event: "donation_recorded",
      amount: parsedAmount,
      currency,
      project: projectId,
      donor: donorAddress,
      txHash: transactionHash,
    }, "Donation recorded");

    const donationRow = donationResult?.rows?.[0] || {};
    const io = req.app?.get("io");

    // Badge tier reflects the donor's cumulative total after this donation.
    const newBadges = computeBadges(newTotalDonated);
    const newTier = newBadges[0]?.tier || null;
    const donorBadge = newTier ? newTier.charAt(0).toUpperCase() + newTier.slice(1) : "";

    const projectName = (projectResult.rows[0] && projectResult.rows[0].name) || "GreenPay Project";

    if (io && typeof io.emit === "function") {
      io.emit("donation_event", {
        projectId,
        projectName,
        donorAddress,
        amountXLM: donationRow.amount_xlm ?? parsedAmount,
        transactionHash,
        timestamp: new Date().toISOString(),
        activeCampaignProgressPercent: null,
        campaignGoalXLM: null,
        campaignRaisedXLM: null,
        donorBadge,
      });
    }

    // Detect badge tier upgrades caused by this donation and emit badge_earned
    try {
      const prevTier = computeBadges(prevTotalDonated)[0]?.tier || null;
      if (newTier && prevTier !== newTier && io && typeof io.emit === "function") {
        io.emit("badge_earned", {
          donorAddress,
          badge: newTier,
          projectId,
        });
      }
    } catch (err) {
      // Do not let badge emit failures break donation flow
      logger.error({ event: "badge_emit_failed", err, donorAddress, projectId }, "Failed to emit badge_earned");
    }

    donationEvents.emit("new_donation", {
      projectName,
      amountXLM: String(donationRow.amount_xlm ?? parsedAmount),
      donorBadge,
    });

    res.status(201).json({ success: true, data: mapDonationRow(donationResult.rows[0]) });
  } catch (e) {
    if (inTransaction && client) await client.query("ROLLBACK");
    console.error(e);
    next(e);
  } finally {
    if (client) client.release();
  }
}

/**
 * Register a donation via the public API.
 *
 * @route POST /api/donations
 * @param {import('express').Request} req - Express request containing the donation payload.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the created donation payload.
 * @throws {Error} If rate limiting or donation creation fails.
 */
router.post("/", donationLimiter, recordDonation);

// GET /api/donations/stream
router.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write("retry: 1000\n\n");

  const onNewDonation = (donation) => {
    res.write(`data: ${JSON.stringify(donation)}\n\n`);
  };
  donationEvents.on("new_donation", onNewDonation);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": keepalive\n\n");
    }
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    donationEvents.removeListener("new_donation", onNewDonation);
  };

  req.on("close", cleanup);
  req.on("end", cleanup);
  req.on("aborted", cleanup);

  // Best-effort initial snapshot of recent donations; a failure here must
  // not tear down the already-open SSE connection or its listener.
  Promise.resolve(pool.query(
    `SELECT d.*, p.name AS project_name
     FROM donations d
     JOIN projects p ON p.id = d.project_id
     ORDER BY d.created_at DESC
     LIMIT 10`,
  )).then((result) => {
    if (res.writableEnded) return;
    res.write(`event: initial\ndata: ${JSON.stringify({ donations: result.rows.map((row) => ({
      ...mapDonationRow(row),
      projectName: row.project_name || null,
    })) })}\n\n`);
  }).catch(() => {
    // Non-fatal: the live stream still works without the initial snapshot.
  });
});

// GET /api/donations/project/:id
router.get("/project/:projectId/messages", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const result = await pool.query(
      `SELECT d.*, p.co2_per_xlm
       FROM donations d
       JOIN projects p ON d.project_id = p.id
       WHERE d.project_id = $1
         AND d.message IS NOT NULL
         AND length(trim(d.message)) > 0
       ORDER BY d.amount DESC, d.created_at DESC
       LIMIT $2`,
      [req.params.projectId, limit],
    );
    res.json({ success: true, data: result.rows.map(mapDonationRow) });
  } catch (e) {
    next(e);
  }
});

/**
 * List donations for a specific project.
 *
 * @route GET /api/donations/project/:projectId
 * @param {import('express').Request} req - Express request containing the project id and pagination options.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the paginated donation history.
 * @throws {Error} If the donation query fails.
 */
router.get("/project/:projectId", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const hasCursor = Boolean(req.query.cursor);
    const values = hasCursor
      ? [req.params.projectId, req.query.cursor, limit + 1]
      : [req.params.projectId, limit + 1];

    const query = hasCursor
      ? `SELECT d.*, p.co2_per_xlm
         FROM donations d
         JOIN projects p ON d.project_id = p.id
         WHERE d.project_id = $1
           AND d.created_at < $2::timestamptz
         ORDER BY d.created_at DESC
         LIMIT $3`
      : `SELECT d.*, p.co2_per_xlm
         FROM donations d
         JOIN projects p ON d.project_id = p.id
         WHERE d.project_id = $1
         ORDER BY d.created_at DESC
         LIMIT $2`;

    const donations = (await pool.query(query, values)).rows.map(mapDonationRow);
    const hasMore = donations.length > limit;
    const result = hasMore ? donations.slice(0, limit) : donations;
    const nextCursor = hasMore ? result[result.length - 1].createdAt : null;

    res.json({ success: true, data: result, nextCursor });
  } catch (e) {
    next(e);
  }
});

/**
 * List donations for a specific donor.
 *
 * @route GET /api/donations/donor/:publicKey
 * @param {import('express').Request} req - Express request containing the donor public key.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends the donor donation history.
 * @throws {Error} If validation or the donation query fails.
 */
router.get("/donor/:publicKey", async (req, res, next) => {
  try {
    validateKey(req.params.publicKey);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const hasCursor = Boolean(req.query.cursor);
    const values = [req.params.publicKey];

    if (hasCursor) {
      try {
        const cursorData = JSON.parse(
          Buffer.from(req.query.cursor, "base64").toString("utf8"),
        );
        const cursorCreatedAt = cursorData.created_at;
        const cursorId = cursorData.id;
        if (!cursorCreatedAt || !cursorId) {
          return res.status(400).json({ error: "Invalid cursor" });
        }
        values.push(cursorCreatedAt, cursorId);
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
    }

    values.push(limit + 1);
    const query = hasCursor
      ? `SELECT d.*, p.co2_per_xlm
         FROM donations d
         JOIN projects p ON d.project_id = p.id
         WHERE d.donor_address = $1
           AND (d.created_at < $2::timestamptz OR (d.created_at = $2::timestamptz AND d.id < $3))
         ORDER BY d.created_at DESC, d.id DESC
         LIMIT $4`
      : `SELECT d.*, p.co2_per_xlm
         FROM donations d
         JOIN projects p ON d.project_id = p.id
         WHERE d.donor_address = $1
         ORDER BY d.created_at DESC, d.id DESC
         LIMIT $2`;

    const donations = (await pool.query(query, values)).rows.map(mapDonationRow);
    const hasMore = donations.length > limit;
    const result = hasMore ? donations.slice(0, limit) : donations;
    const nextCursor = hasMore
      ? Buffer.from(
        JSON.stringify({
          created_at: result[result.length - 1].createdAt,
          id: result[result.length - 1].id,
        }),
      ).toString("base64")
      : null;

    res.json({ success: true, data: result, has_more: hasMore, next_cursor: nextCursor });
  } catch (e) { next(e); }
});

// GET /api/donations/:id - single donation fetch endpoint
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    // Basic UUID validation
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      const e = new Error("Invalid donation ID");
      e.status = 400;
      throw e;
    }

    const query = `
      SELECT 
        d.*,
        p.name AS project_name,
        p.co2_per_xlm,
        pr.display_name AS donor_display_name
      FROM donations d
      JOIN projects p ON d.project_id = p.id
      LEFT JOIN profiles pr ON d.donor_address = pr.public_key
      WHERE d.id = $1
    `;
    const result = await pool.query(query, [id]);

    if (!result.rows[0]) {
      const e = new Error("Donation not found");
      e.status = 404;
      throw e;
    }

    const row = result.rows[0];
    const donationData = mapDonationRow(row);
    donationData.projectName = row.project_name;
    donationData.donorDisplayName = row.donor_display_name || null;

    res.json({ success: true, data: donationData });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.recordDonation = recordDonation;
