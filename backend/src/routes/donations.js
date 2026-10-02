/**
 * src/routes/donations.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { v4: uuid } = require("uuid");
const geoip = require("geoip-lite");
const logger = require("../logger");
const pool = require("../db/pool");
const redis = require("../services/redis");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { walletAuthRequired } = require("../middleware/auth");
const { computeBadges, mapDonationRow } = require("../services/store");
const { server } = require("../services/stellar");
const donationEvents = require("../services/donationEvents");
const { enqueueProfileUpdate } = require("../services/profileQueue");
const { countDonation } = require("../services/metrics");
const { checkAndDeliverMilestones } = require("../services/webhook");
const { enqueueDonationPushNotification } = require("../services/donationPushQueue");
const configuredDonationLimit = Number.parseInt(process.env.DONATIONS_RATE_LIMIT_PER_MINUTE || "10", 10);
const donationLimiter = createRateLimiter(
  Number.isFinite(configuredDonationLimit) && configuredDonationLimit > 0 ? configuredDonationLimit : 10,
  1,
  "donations",
);

// ── CSV export helpers ────────────────────────────────────────────────────────

// In-memory cache of historical XLM/USD prices keyed by YYYY-MM-DD, so a
// donor's export (and repeat exports) don't re-fetch the same day.
const historicalPriceCache = new Map();

/**
 * Fetch the historical XLM/USD price for a single day from CoinGecko's
 * free history endpoint. Returns null when the price is unavailable
 * (network error, rate limit, or malformed response) — the export still
 * succeeds, the USD column is just left blank for that day.
 *
 * @param {string} isoDate — YYYY-MM-DD
 * @returns {Promise<number|null>}
 */
async function fetchHistoricalXlmPrice(isoDate) {
  if (historicalPriceCache.has(isoDate)) {
    return historicalPriceCache.get(isoDate);
  }

  // CoinGecko expects DD-MM-YYYY.
  const [year, month, day] = isoDate.split("-");
  const coinGeckoDate = `${day}-${month}-${year}`;
  let price = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/stellar/history?date=${encodeURIComponent(coinGeckoDate)}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (res.ok) {
      const body = await res.json();
      const usd = body?.market_data?.current_price?.usd;
      if (typeof usd === "number" && usd > 0) price = usd;
    }
  } catch {
    price = null;
  }

  historicalPriceCache.set(isoDate, price);
  return price;
}

/**
 * Resolve the historical XLM/USD price for every unique donation date.
 *
 * @param {Array<{created_at: string|Date}>} rows
 * @returns {Promise<Map<string, number|null>>} — YYYY-MM-DD → price (or null)
 */
async function resolveHistoricalPrices(rows) {
  const dates = new Set();
  for (const row of rows) {
    const iso = new Date(row.created_at).toISOString().slice(0, 10);
    dates.add(iso);
  }
  const entries = await Promise.all(
    [...dates].map(async (iso) => [iso, await fetchHistoricalXlmPrice(iso)]),
  );
  return new Map(entries);
}

/**
 * Escape a value for CSV output: wrap in quotes when it contains a comma,
 * quote, or newline, and double any embedded quotes.
 *
 * @param {unknown} value
 * @returns {string}
 */
function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

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

    // Determine numeric amount depending on currency
    const parsedAmount = parseFloat(currency === "XLM" ? amountXLM ?? amount : amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      const e = new Error("Donation amount must be a positive number");
      e.status = 400;
      throw e;
    }

    client = await pool.connect();

    const projectResult = await client.query("SELECT id, co2_per_xlm, name, wallet_address FROM projects WHERE id = $1", [projectId]);
    if (!projectResult.rows[0]) { const e = new Error("Project not found"); e.status = 404; throw e; }
    const projectCo2PerXlm = projectResult.rows[0].co2_per_xlm;

    // Deduplicate by tx hash
    const existingResult = await client.query(
      "SELECT * FROM donations WHERE transaction_hash = $1",
      [transactionHash],
    );
    if (existingResult.rows[0]) {
      const existingRow = { ...existingResult.rows[0], co2_per_xlm: projectCo2PerXlm };
      return res.status(200).json({ success: true, data: mapDonationRow(existingRow) });
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

    // Award referral bonus if this is the referred user's first donation
    if (currency === "XLM") {
      try {
        const referralCheck = await pool.query(
          "SELECT COUNT(*) as count FROM donations WHERE donor_address = $1",
          [donorAddress]
        );
        const donationCount = parseInt(referralCheck.rows[0]?.count || "0");
        
        // If this is the first donation, award referral bonus
        if (donationCount === 1) {
          await fetch(`${process.env.API_URL || "http://localhost:4000"}/api/v1/referrals/award-bonus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              referredAddress: donorAddress,
              donationId: donationResult.rows[0].id,
              amountXLM: parsedAmount.toString()
            })
          }).catch(err => logger.error("Failed to award referral bonus:", err));
        }
      } catch (err) {
        logger.error("Referral bonus check failed:", err);
      }
    }

    await redis.deletePattern("projects:list:*");
    // The leaderboard aggregates the row just inserted, so every cached page is
    // now stale (issue #1093). Donations recorded out-of-band by the indexer are
    // not invalidated here; the 60-second TTL bounds how long they stay stale.
    await redis.deletePattern("leaderboard:*");

    const xlmForMetrics = currency === "XLM" ? parsedAmount : 0;
    countDonation(currency, xlmForMetrics);

    await enqueueProfileUpdate(donorAddress).catch((err) => {
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

    if (io) {
      const donationPayload = {
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
      };
      if (typeof io.to === "function") {
        io.to([`project:${projectId}`, "all-donations"]).emit("donation_event", donationPayload);
      } else if (typeof io.emit === "function") {
        io.emit("donation_event", donationPayload);
      }
    }

    // Detect badge tier upgrades caused by this donation and emit badge_earned
    try {
      const prevTier = computeBadges(prevTotalDonated)[0]?.tier || null;
      if (newTier && prevTier !== newTier && io) {
        const badgePayload = {
          donorAddress,
          badge: newTier,
          projectId,
        };
        if (typeof io.to === "function") {
          io.to(`project:${projectId}`).emit("badge_earned", badgePayload);
        } else if (typeof io.emit === "function") {
          io.emit("badge_earned", badgePayload);
        }
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

    // Enqueue push notification to project admin (non-blocking)
    enqueueDonationPushNotification({
      projectId,
      projectName,
      amountXLM: String(donationRow.amount_xlm ?? parsedAmount),
      donorBadge,
    }).catch((err) => {
      logger.error({ event: "donation_push_enqueue_error", projectId, err: err.message }, "Failed to enqueue donation push notification");
    });

    await checkAndDeliverMilestones(projectId).catch((err) => {
      logger.error({ event: "milestone_webhook_error", projectId, err: err.message }, "Failed to deliver milestone webhooks");
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

/**
 * List donations with optional project filtering and cursor pagination.
 * By default, donor wallet addresses are truncated to first 8 + last 4 characters.
 * Authenticated wallet owners and admins receive full addresses.
 *
 * @route GET /api/donations
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
router.get("/", async (req, res, next) => {
  try {
    const projectId = req.query.project_id || req.query.projectId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const hasCursor = Boolean(req.query.cursor);

    let query;
    let values;

    if (projectId) {
      if (hasCursor) {
        query = `SELECT d.*, p.co2_per_xlm
                 FROM donations d
                 JOIN projects p ON d.project_id = p.id
                 WHERE (d.project_id::text = $1 OR p.wallet_address = $1)
                   AND d.created_at < $2::timestamptz
                 ORDER BY d.created_at DESC
                 LIMIT $3`;
        values = [projectId, req.query.cursor, limit + 1];
      } else {
        query = `SELECT d.*, p.co2_per_xlm
                 FROM donations d
                 JOIN projects p ON d.project_id = p.id
                 WHERE (d.project_id::text = $1 OR p.wallet_address = $1)
                 ORDER BY d.created_at DESC
                 LIMIT $2`;
        values = [projectId, limit + 1];
      }
    } else {
      if (hasCursor) {
        query = `SELECT d.*, p.co2_per_xlm
                 FROM donations d
                 JOIN projects p ON d.project_id = p.id
                 WHERE d.created_at < $1::timestamptz
                 ORDER BY d.created_at DESC
                 LIMIT $2`;
        values = [req.query.cursor, limit + 1];
      } else {
        query = `SELECT d.*, p.co2_per_xlm
                 FROM donations d
                 JOIN projects p ON d.project_id = p.id
                 ORDER BY d.created_at DESC
                 LIMIT $1`;
        values = [limit + 1];
      }
    }

    const auth = resolveRequesterAuth(req);
    const donations = (await pool.query(query, values)).rows
      .map(mapDonationRow)
      .map((d) => sanitizeDonation(d, auth));
    const hasMore = donations.length > limit;
    const result = hasMore ? donations.slice(0, limit) : donations;
    const nextCursor = hasMore ? result[result.length - 1].createdAt : null;

    res.json({ success: true, data: result, nextCursor });
  } catch (e) {
    next(e);
  }
});

// GET /api/donations/stream
router.get("/stream", (req, res) => {
  const projectId = req.query.projectId || req.query.project_id || "default";
  const lastEventId = req.headers["last-event-id"];

  // When reconnecting, a Last-Event-ID that belongs to a different project
  // than this stream is scoped to is rejected before committing to SSE.
  if (lastEventId != null && lastEventId !== "") {
    const lastIdNum = Number(lastEventId);
    const lastEvent = Number.isNaN(lastIdNum)
      ? undefined
      : donationEvents.findEvent(lastIdNum);
    if (lastEvent && lastEvent.projectId !== projectId) {
      return res.status(400).json({
        error: `Last-Event-ID ${lastEventId} does not belong to project ${projectId}`,
      });
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write("retry: 1000\n\n");

  // Replay events missed since the Last-Event-ID. An unknown id is treated as
  // a cold start and the full project history is replayed (stream reset).
  if (lastEventId != null && lastEventId !== "") {
    const lastIdNum = Number(lastEventId);
    const lastEvent = Number.isNaN(lastIdNum)
      ? undefined
      : donationEvents.findEvent(lastIdNum);
    const replay = lastEvent
      ? donationEvents.getEventsAfter(projectId, lastIdNum)
      : donationEvents.getEventsForProject(projectId);
    for (const event of replay) {
      res.write(`id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
  }

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
    const auth = resolveRequesterAuth(req);
    res.write(`event: initial\ndata: ${JSON.stringify({ donations: result.rows.map((row) => ({
      ...sanitizeDonation(mapDonationRow(row), auth),
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
    const auth = resolveRequesterAuth(req);
    res.json({
      success: true,
      data: result.rows.map(mapDonationRow).map((d) => sanitizeDonation(d, auth)),
    });
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
         WHERE (d.project_id::text = $1 OR p.wallet_address = $1)
           AND d.created_at < $2::timestamptz
         ORDER BY d.created_at DESC
         LIMIT $3`
      : `SELECT d.*, p.co2_per_xlm
         FROM donations d
         JOIN projects p ON d.project_id = p.id
         WHERE (d.project_id::text = $1 OR p.wallet_address = $1)
         ORDER BY d.created_at DESC
         LIMIT $2`;

    const auth = resolveRequesterAuth(req);
    const donations = (await pool.query(query, values)).rows
      .map(mapDonationRow)
      .map((d) => sanitizeDonation(d, auth));
    const hasMore = donations.length > limit;
    const result = hasMore ? donations.slice(0, limit) : donations;
    const nextCursor = hasMore ? result[result.length - 1].createdAt : null;

    res.json({ success: true, data: result, nextCursor });
  } catch (e) {
    next(e);
  }
});

/**
 * List donations for a specific donor, one keyset-paginated page at a time.
 *
 * Query params: `limit` (default 20, max 100) and `cursor` (base64 of
 * `{ created_at, id }`, echoed back as `next_cursor`). The response carries
 * `total` — the donor's whole donation count — so a caller can show progress
 * through the history without fetching all of it (issue #1080).
 *
 * @route GET /api/donations/donor/:publicKey
 * @param {import('express').Request} req - Express request containing the donor public key.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express error middleware.
 * @returns {Promise<void>} Sends one page of the donor's history plus the total count.
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

    // A keyset window can't answer "how many are there in total", which the
    // donor page needs to show progress through its history (issue #1080).
    // Counted concurrently with the page, and served by the same
    // donor_address index the page query uses.
    const auth = resolveRequesterAuth(req);
    const [pageResult, totalResult] = await Promise.all([
      pool.query(query, values),
      pool.query(
        "SELECT COUNT(*)::int AS total FROM donations WHERE donor_address = $1",
        [req.params.publicKey],
      ),
    ]);
    const donations = pageResult.rows
      .map(mapDonationRow)
      .map((d) => sanitizeDonation(d, auth));
    const total = Number(totalResult.rows[0]?.total ?? 0);
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

    res.json({ success: true, data: result, has_more: hasMore, next_cursor: nextCursor, total });
  } catch (e) { next(e); }
});

/**
 * GET /api/donations/export?format=csv
 * Authenticated donor downloads their complete donation history as CSV.
 *
 * Columns: date, project_name, amount_xlm, amount_usd, co2_offset_kg,
 * transaction_hash. The USD value uses the historical XLM price on the
 * donation date (CoinGecko); when a day's price is unavailable the USD
 * cell is left blank rather than fabricating a number.
 *
 * Must be registered before "/:id" so "export" isn't captured as an id.
 */
router.get("/export", walletAuthRequired, async (req, res, next) => {
  try {
    const format = req.query.format || "csv";
    if (format !== "csv") {
      return res.status(400).json({ error: "Unsupported format. Only 'csv' is supported." });
    }

    const donorAddress = req.walletAddress;

    const result = await pool.query(
      `SELECT d.created_at, p.name AS project_name, d.amount_xlm, d.transaction_hash, p.co2_per_xlm
       FROM donations d
       JOIN projects p ON d.project_id = p.id
       WHERE d.donor_address = $1
       ORDER BY d.created_at ASC, d.id ASC`,
      [donorAddress],
    );
    const rows = result.rows;

    const priceByDate = await resolveHistoricalPrices(rows);

    const lines = ["date,project_name,amount_xlm,amount_usd,co2_offset_kg,transaction_hash"];
    for (const row of rows) {
      const date = new Date(row.created_at).toISOString().slice(0, 10);
      const amountXlm = Number.parseFloat(row.amount_xlm) || 0;
      const price = priceByDate.get(date);
      const amountUsd = price != null ? (amountXlm * price).toFixed(2) : "";
      // co2_per_xlm is stored in grams per XLM; /1000 converts to kg.
      const co2PerXlm = Number.parseFloat(row.co2_per_xlm) || 0;
      const co2OffsetKg = ((amountXlm * co2PerXlm) / 1000).toFixed(2);

      lines.push([
        date,
        csvEscape(row.project_name),
        amountXlm.toFixed(7),
        amountUsd,
        co2OffsetKg,
        row.transaction_hash,
      ].join(","));
    }

    const csv = lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"donation-history.csv\"");
    res.send(csv);
  } catch (e) {
    next(e);
  }
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

    const auth = resolveRequesterAuth(req);
    const sanitized = sanitizeDonation(donationData, auth);

    res.json({ success: true, data: sanitized });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.recordDonation = recordDonation;
module.exports.maskWalletAddress = maskWalletAddress;
module.exports.resolveRequesterAuth = resolveRequesterAuth;
module.exports.sanitizeDonation = sanitizeDonation;

