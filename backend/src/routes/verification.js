/**
 * src/routes/verification.js — Project verification requests
 *
 * Climate organisations use the /apply form on the frontend to ask the
 * GreenPay admin team to verify a project. This router accepts the
 * submission, persists it to the `verification_requests` table, and
 * fires an admin notification email through services/email.js.
 *
 * Public surface:
 *   - POST /api/verification-requests   Submit a new request (open).
 *   - GET  /api/verification-requests/me
 *       Existing rows indexed by wallet; lets the submitter check the
 *       status of their request without admin credentials. Filters by
 *       ?wallet=Gxxxxxxx.
 *   - GET  /api/verification-requests/:id   Read a single row (admin-only
 *       unless the caller supplies ?wallet=Gxxx matching wallet_address,
 *       so submitters can re-fetch their own submission).
 *   - GET  /api/verification-requests       List all rows (admin-only).
 *   - PATCH /api/verification-requests/:id/status   Approve / reject.
 *       Body: { status: "in_review" | "approved" | "rejected",
 *               reviewerNotes?: string, reviewerBy?: string }
 *
 * Admin endpoints expect a Bearer JWT issued by /api/admin/login, the same
 * mechanism already used by projects.admin/register (see middleware/auth.js).
 */
"use strict";

const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const { adminRequired } = require("../middleware/auth");
const { logAdminAction } = require("../services/audit");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { sendAdminVerificationNotification } = require("../services/email");
const { backendName } = require("../services/storage");

const submitLimiter = createRateLimiter(10, 15); // 10 submissions / 15 min / IP

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

const VALID_TRANSITIONS = {
  pending: ["in_review", "rejected"],
  in_review: ["approved", "rejected", "pending"],
  approved: [],
  rejected: ["pending"],
};

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]{2,}$/i;

function mapRequestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationName: row.organization_name,
    organizationWebsite: row.organization_website || null,
    organizationCountry: row.organization_country || null,
    contactEmail: row.contact_email,
    walletAddress: row.wallet_address,
    projectName: row.project_name,
    projectCategory: row.project_category,
    projectLocation: row.project_location,
    projectDescription: row.project_description || null,
    co2PerXLM: row.co2_per_xlm?.toString
      ? row.co2_per_xlm.toString()
      : String(row.co2_per_xlm || "0"),
    expectedAnnualTonnesCO2: row.expected_annual_tonnes_co2?.toString
      ? row.expected_annual_tonnes_co2.toString()
      : row.expected_annual_tonnes_co2
        ? String(row.expected_annual_tonnes_co2)
        : null,
    supportingDocuments: row.supporting_documents || [],
    storageBackend: row.storage_backend,
    notes: row.notes || null,
    status: row.status,
    reviewerNotes: row.reviewer_notes || null,
    reviewedBy: row.reviewed_by || null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  };
}

function validateDocument(doc) {
  if (!doc || typeof doc !== "object") return "each document must be an object";
  if (typeof doc.url !== "string" || !URL_RE.test(doc.url)) return "document.url must be an http(s) URL";
  if (typeof doc.name !== "string" || doc.name.length < 1 || doc.name.length > 200) {
    return "document.name must be a string (1-200 chars)";
  }
  if (typeof doc.size === "number" && doc.size < 0) return "document.size must be >= 0";
  return null;
}

/**
 * POST /api/verification-requests
 * Public. Persists the submission and notifies admins by email.
 */
router.post("/", submitLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const errors = [];

    const orgName = typeof body.organizationName === "string" ? body.organizationName.trim() : "";
    if (orgName.length < 2 || orgName.length > 200) {
      errors.push("organizationName must be 2-200 characters");
    }

    let website = null;
    if (body.organizationWebsite != null && body.organizationWebsite !== "") {
      if (typeof body.organizationWebsite !== "string" || body.organizationWebsite.length > 500) {
        errors.push("organizationWebsite must be a string up to 500 characters");
      } else if (!URL_RE.test(body.organizationWebsite)) {
        errors.push("organizationWebsite must be a valid http(s) URL");
      } else {
        website = body.organizationWebsite.trim();
      }
    }

    let country = null;
    if (body.organizationCountry != null && body.organizationCountry !== "") {
      if (typeof body.organizationCountry !== "string" || body.organizationCountry.trim().length > 80) {
        errors.push("organizationCountry must be a string up to 80 characters");
      } else {
        country = body.organizationCountry.trim();
      }
    }

    const email = typeof body.contactEmail === "string" ? body.contactEmail.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) errors.push("contactEmail must be a valid email");

    const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress.trim() : "";
    if (!STELLAR_ADDRESS_RE.test(walletAddress)) {
      errors.push("walletAddress must be a valid Stellar address (56 chars, starts with G)");
    }

    const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
    if (projectName.length < 2 || projectName.length > 200) {
      errors.push("projectName must be 2-200 characters");
    }

    const projectCategory = typeof body.projectCategory === "string" ? body.projectCategory.trim() : "";
    if (!VALID_CATEGORIES.includes(projectCategory)) {
      errors.push(`projectCategory must be one of: ${VALID_CATEGORIES.join(", ")}`);
    }

    const projectLocation = typeof body.projectLocation === "string" ? body.projectLocation.trim() : "";
    if (projectLocation.length < 2 || projectLocation.length > 200) {
      errors.push("projectLocation must be 2-200 characters");
    }

    let projectDescription = null;
    if (body.projectDescription != null && body.projectDescription !== "") {
      if (typeof body.projectDescription !== "string" || body.projectDescription.length > 5000) {
        errors.push("projectDescription must be a string up to 5000 characters");
      } else {
        projectDescription = body.projectDescription.trim();
      }
    }

    const co2PerXLM = Number.parseFloat(body.co2PerXLM);
    if (!Number.isFinite(co2PerXLM) || co2PerXLM < 0) {
      errors.push("co2PerXLM must be a non-negative number");
    }

    let expectedAnnualTonnesCO2 = null;
    if (body.expectedAnnualTonnesCO2 != null && body.expectedAnnualTonnesCO2 !== "") {
      const parsed = Number.parseFloat(body.expectedAnnualTonnesCO2);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push("expectedAnnualTonnesCO2 must be a non-negative number when provided");
      } else {
        expectedAnnualTonnesCO2 = parsed;
      }
    }

    const documents = Array.isArray(body.supportingDocuments) ? body.supportingDocuments : [];
    if (documents.length > 20) {
      errors.push("supportingDocuments must contain at most 20 entries");
    }
    // Collect every document error so the submitter can fix them all in one
    // pass instead of submitting and re-submitting one fix at a time.
    documents.forEach((doc, index) => {
      const err = validateDocument(doc);
      if (err) errors.push(`supportingDocuments[${index}]: ${err}`);
    });

    let notes = null;
    if (body.notes != null && body.notes !== "") {
      if (typeof body.notes !== "string" || body.notes.length > 2000) {
        errors.push("notes must be a string up to 2000 characters");
      } else {
        notes = body.notes.trim();
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join("; ") });
    }

    const id = uuid();
    const result = await pool.query(
      `INSERT INTO verification_requests (
         id, organization_name, organization_website, organization_country,
         contact_email, wallet_address, project_name, project_category,
         project_location, project_description, co2_per_xlm,
         expected_annual_tonnes_co2, supporting_documents, storage_backend, notes
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10, $11,
         $12, $13::jsonb, $14, $15
       ) RETURNING *`,
      [
        id,
        orgName,
        website,
        country,
        email,
        walletAddress,
        projectName,
        projectCategory,
        projectLocation,
        projectDescription,
        co2PerXLM.toFixed(7),
        expectedAnnualTonnesCO2 != null ? expectedAnnualTonnesCO2.toFixed(7) : null,
        JSON.stringify(documents),
        backendName(),
        notes,
      ],
    );

    const created = mapRequestRow(result.rows[0]);

    // Fire-and-forget admin notification; failures here must NOT block the
    // persist + 201 success path. The submitter still gets their receipt.
    sendAdminVerificationNotification(created).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[verification] admin notification failed:", err.message);
    });

    res.status(201).json({
      success: true,
      data: {
        ...created,
        reviewTimeline: "5–10 business days",
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/verification-requests/me?wallet=Gxxx
 * Public. Returns the request rows owned by the queried wallet (most recent
 * first). Lets submitters check status without admin auth. Capped at 50.
 */
router.get("/me", async (req, res, next) => {
  try {
    const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
    if (!STELLAR_ADDRESS_RE.test(wallet)) {
      return res.status(400).json({ error: "wallet query param must be a valid Stellar address" });
    }
    const result = await pool.query(
      `SELECT * FROM verification_requests
        WHERE wallet_address = $1
        ORDER BY submitted_at DESC
        LIMIT 50`,
      [wallet],
    );
    res.json({ success: true, data: result.rows.map(mapRequestRow) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/verification-requests/:id
 * Public, but only returns the row if wallet query param matches
 * the row's wallet_address. Admins can pass ?wallet to bypass this check
 * using the Bearer token.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM verification_requests WHERE id = $1", [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "Verification request not found" });

    // Allow admin-readable without wallet guard.
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) {
      try {
        const { verifyToken } = require("../middleware/auth");
        const decoded = verifyToken(auth.slice(7));
        if (decoded && decoded.role === "admin") {
          return res.json({ success: true, data: mapRequestRow(row) });
        }
      } catch (_err) {
        // fall through to wallet check
      }
    }

    const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
    if (!wallet || wallet !== row.wallet_address) {
      return res.status(403).json({ error: "Provide a matching ?wallet= query param to view this request" });
    }
    res.json({ success: true, data: mapRequestRow(row) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/verification-requests
 * Admin only. Returns the most recent submissions with optional filters.
 */
router.get("/", adminRequired, async (req, res, next) => {
  try {
    const { status, limit = "50", page = "1" } = req.query;
    const where = [];
    const values = [];

    if (status && Object.keys(VALID_TRANSITIONS).includes(status)) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }

    const pageSize = Math.min(Number.parseInt(limit, 10) || 50, 200);
    const offset = (Math.max(Number.parseInt(page, 10) || 1, 1) - 1) * pageSize;
    values.push(pageSize, offset);

    let query = "SELECT * FROM verification_requests";
    if (where.length) query += " WHERE " + where.join(" AND ");
    query += ` ORDER BY submitted_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const result = await pool.query(query, values);
    res.json({
      success: true,
      data: result.rows.map(mapRequestRow),
      page: Number.parseInt(page, 10),
      pageSize,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/verification-requests/:id/status
 * Admin only. Transitions the row's status and records reviewer notes.
 */
router.patch("/:id/status", adminRequired, async (req, res, next) => {
  try {
    const { status, reviewerNotes, reviewedBy } = req.body || {};
    if (!status || !Object.keys(VALID_TRANSITIONS).includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${Object.keys(VALID_TRANSITIONS).join(", ")}`,
      });
    }
    const reviewerNotesStr = typeof reviewerNotes === "string" && reviewerNotes.trim() ? reviewerNotes.trim() : null;
    if (reviewerNotesStr && reviewerNotesStr.length > 2000) {
      return res.status(400).json({ error: "reviewerNotes must be at most 2000 characters" });
    }

    const existing = await pool.query("SELECT * FROM verification_requests WHERE id = $1", [req.params.id]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: "Verification request not found" });

    const transitions = VALID_TRANSITIONS[row.status] || [];
    if (row.status === status) {
      return res.status(400).json({ error: `Request is already in "${status}" state` });
    }
    if (!transitions.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from "${row.status}" to "${status}"`,
      });
    }

    const actor = (req.admin && req.admin.sub) || reviewedBy || "admin";
    const updated = await pool.query(
      `UPDATE verification_requests
          SET status = $1,
              reviewer_notes = $2,
              reviewed_by = $3,
              reviewed_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [status, reviewerNotesStr, actor, req.params.id],
    );

    logAdminAction({
      actor,
      action: `verification.${status}`,
      targetType: "verification_request",
      targetId: req.params.id,
      metadata: { fromStatus: row.status, toStatus: status, reviewerNotes: reviewerNotesStr },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: mapRequestRow(updated.rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
