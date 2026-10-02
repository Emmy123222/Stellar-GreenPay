/**
 * src/services/moderation.js — project-update image content moderation (#1101)
 *
 * Project owners attach images to project updates. Those images land in S3 with
 * `ACL: "public-read"` (see src/services/storage.js → uploadS3) and are served
 * to every visitor, so an unmoderated image is a fraud/NSFW vector. This module
 * scans images with AWS Rekognition `DetectModerationLabels` and records every
 * decision in the `update_images` table (migration
 * 008_update_images_moderation.js), which doubles as the admin review queue.
 *
 * ── Where this runs in the request flow ─────────────────────────────────────
 *   1. POST /api/uploads (src/routes/uploads.js) — immediately after the bytes
 *      are written to S3. The buffer is still in memory, so the scan uses
 *      Rekognition's ImageContent form (no extra S3 round trip). A rejected
 *      image returns 422 and the object is deleted best-effort, so a caller
 *      never receives a usable URL for it.
 *   2. POST /api/updates (src/routes/updates.js) — before the `project_updates`
 *      INSERT. Clients may upload straight to S3 with a presigned URL
 *      (POST /api/uploads/presign), which bypasses step 1, so publish time is
 *      the enforcement point: the recorded decision for that object is reused
 *      when present, otherwise the S3 object is scanned on demand. Rejected →
 *      422 and nothing is persisted; unavailable scanner → 503.
 *
 * ── Confidence semantics ────────────────────────────────────────────────────
 *      All confidences in this file are PERCENTAGES in 0–100, exactly as
 *      Rekognition returns them (`Label.Confidence`). They are never fractions.
 *      Auto-rejection is strictly GREATER THAN the reject threshold (the AC says
 *      "above 70%"), so 70.0 itself is NOT auto-rejected — it falls through to
 *      review flagging. Review flagging is >= its (lower) threshold.
 *
 * ── Fail-open vs fail-closed (deliberate decision) ──────────────────────────
 *      Two different states, handled differently:
 *
 *      a) NOT CONFIGURED — this deployment does not publish images from S3
 *         (any of AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 *         S3_BUCKET missing, which is also what POST /api/uploads/presign
 *         requires) or moderation is explicitly disabled. Nothing can be
 *         scanned and nothing pretends otherwise: the verdict is `skipped` and
 *         the image passes through. This is what makes the local dev/test setup
 *         (STORAGE_BACKEND=local, no AWS account) work unmodified, and the
 *         object was never going to be published from S3.
 *
 *      b) CONFIGURED BUT FAILED — optional SDK missing, Rekognition API error
 *         or timeout, credentials rejected, object not found, or an image URL
 *         that does not resolve to our own bucket (nothing scannable without
 *         downloading arbitrary user-supplied URLs — SSRF). This is a security
 *         control, so the DEFAULT IS FAIL-CLOSED: the verdict is `unavailable`,
 *         the route answers 503 and the image/update is NOT published. Silently
 *         passing NSFW content because the scanner broke would make the control
 *         bypassable by anyone who can induce an API error.
 *
 *      Operators can opt out of that availability risk with
 *      `IMAGE_MODERATION_FAIL_MODE=open`, which downgrades a scan failure to
 *      `pending_review`, records the failure reason in `update_images` and
 *      flags it for an admin instead of blocking. Both paths log a structured
 *      `image_moderation_unavailable` event, so a fail-open deployment still
 *      surfaces the gap. Neither path ever throws out of a route handler.
 *
 * ── Environment ─────────────────────────────────────────────────────────────
 *   IMAGE_MODERATION_ENABLED            default "true"; "false" turns the
 *                                       control off entirely (verdict: skipped)
 *   IMAGE_MODERATION_FAIL_MODE          "closed" (default) | "open"
 *   IMAGE_MODERATION_REJECT_CONFIDENCE  auto-reject threshold, percent. default 70
 *   IMAGE_MODERATION_REVIEW_CONFIDENCE  review-flag threshold, percent.  default 50
 *   IMAGE_MODERATION_REJECT_FAMILIES    comma-separated label families that
 *                                       auto-reject. default "Explicit Nudity,Violence"
 *   IMAGE_MODERATION_TIMEOUT_MS         per-call SDK timeout.       default 5000
 *   AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET / S3_PUBLIC_URL
 *
 * The Rekognition SDK is required LAZILY inside createRekognitionClient() so
 * that this module (and every existing test that transitively imports it) keeps
 * loading even when @aws-sdk/client-rekognition is not installed yet.
 */
"use strict";

const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const logger = require("../logger");

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDER = "aws_rekognition";

/** Moderation verdicts persisted in `update_images.status`. */
const STATUS = Object.freeze({
  APPROVED: "approved",
  REJECTED: "rejected",
  PENDING_REVIEW: "pending_review",
});

/**
 * Verdict outcomes returned by moderateImage(). `status` is always one of the
 * persisted STATUS values except for these two non-persistable outcomes:
 *   skipped      — moderation is off / not configured; nothing was scanned.
 *   unavailable  — a scan was required but failed; the caller must answer 503.
 */
const OUTCOME = Object.freeze({
  ...STATUS,
  SKIPPED: "skipped",
  UNAVAILABLE: "unavailable",
});

const DEFAULTS = Object.freeze({
  REJECT_CONFIDENCE: 70,
  REVIEW_CONFIDENCE: 50,
  REJECT_FAMILIES: "Explicit Nudity,Violence",
  REQUEST_TIMEOUT_MS: 5000,
  FAIL_MODE: "closed",
});

/** Error marker used to distinguish "scanner broken" from "content bad". */
class ModerationUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ModerationUnavailableError";
    this.code = "MODERATION_UNAVAILABLE";
    if (cause) this.cause = cause;
  }
}

// ── Config helpers ───────────────────────────────────────────────────────────

/**
 * Lenient boolean env parse: unset/blank keeps the fallback, so a typo in .env
 * degrades to the documented default instead of silently disabling a control.
 *
 * @param {string|undefined} raw
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseBooleanEnv(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

/**
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function parseNumberEnv(raw, fallback) {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {string|undefined} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function parsePercentEnv(raw, fallback, min, max) {
  const parsed = parseNumberEnv(raw, fallback);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normaliseFamily(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Effective moderation configuration, read at CALL time (not module load) so
 * tests and ops tooling can flip env vars without restarting the process.
 *
 * @returns {{enabled: boolean, failMode: string, rejectConfidence: number,
 *            reviewConfidence: number, rejectFamilies: string[],
 *            requestTimeoutMs: number}}
 */
function getModerationConfig() {
  const failModeRaw = String(process.env.IMAGE_MODERATION_FAIL_MODE || "").trim().toLowerCase();
  const failMode = ["closed", "open"].includes(failModeRaw) ? failModeRaw : DEFAULTS.FAIL_MODE;

  const familiesRaw = String(process.env.IMAGE_MODERATION_REJECT_FAMILIES || "").trim();
  const families = (familiesRaw || DEFAULTS.REJECT_FAMILIES)
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean);
  return {
    enabled: parseBooleanEnv(process.env.IMAGE_MODERATION_ENABLED, true),
    failMode,
    rejectConfidence: parsePercentEnv(
      process.env.IMAGE_MODERATION_REJECT_CONFIDENCE,
      DEFAULTS.REJECT_CONFIDENCE,
      0,
      100,
    ),
    reviewConfidence: parsePercentEnv(
      process.env.IMAGE_MODERATION_REVIEW_CONFIDENCE,
      DEFAULTS.REVIEW_CONFIDENCE,
      0,
      100,
    ),
    rejectFamilies: families.length > 0 ? families : DEFAULTS.REJECT_FAMILIES.split(","),
    requestTimeoutMs: parseNumberEnv(
      process.env.IMAGE_MODERATION_TIMEOUT_MS,
      DEFAULTS.REQUEST_TIMEOUT_MS,
    ),
  };
}

/**
 * True when this deployment really stores images in S3 and can call
 * Rekognition: the same four variables src/services/s3Presign.js requires
 * (isS3Configured). S3_BUCKET is part of the check because without it no image
 * can be published from S3 (POST /api/uploads/presign already answers 503), so
 * there would be nothing to moderate — the local backend serves uploads with
 * Content-Disposition: attachment instead of exposing a public image URL.
 *
 * @returns {boolean}
 */
function isModerationConfigured() {
  return !!(
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET
  );
}

/**
 * Convenience predicate for routes: would a scan be attempted for this deploy?
 *
 * @returns {boolean}
 */
function isModerationEnforced() {
  return getModerationConfig().enabled && isModerationConfigured();
}

// ── AWS client (lazy) ────────────────────────────────────────────────────────

/**
 * Build the pieces needed to call Rekognition.
 *
 * Returns a factory *object* rather than a bare client because the command
 * class has to come from the same lazily-required module, and because it gives
 * tests one seam to stub (`jest.spyOn(moderation, "createRekognitionClient")`)
 * without the optional @aws-sdk/client-rekognition dependency being installed.
 *
 * @returns {{client: object, DetectModerationLabelsCommand: Function}}
 * @throws {ModerationUnavailableError} when the SDK is not installed
 */
function createRekognitionClient() {
  let sdk;
  try {
    // Optional dependency: required at CALL time only, never at boot, so a
    // missing package cannot take the app down (see header note b).
    // eslint-disable-next-line global-require
    sdk = require("@aws-sdk/client-rekognition");
  } catch (err) {
    logger.warn(
      { event: "image_moderation_sdk_missing", err: err.message },
      "@aws-sdk/client-rekognition is not installed — image moderation is unavailable",
    );
    throw new ModerationUnavailableError(
      "Image moderation service is not installed on this server",
      err,
    );
  }

  const config = getModerationConfig();
  const client = new sdk.RekognitionClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    maxAttempts: 2,
    requestTimeout: config.requestTimeoutMs,
  });

  return { client, DetectModerationLabelsCommand: sdk.DetectModerationLabelsCommand };
}

// ── Label normalisation ──────────────────────────────────────────────────────

/**
 * Rekognition returns confidence as a percentage (0–100). Anything non-numeric
 * or out of range is clamped so a malformed label can never out-rank a real one
 * and the `update_images.max_confidence` CHECK constraint always holds.
 *
 * @param {unknown} value
 * @returns {number} confidence in percent, 0 when unusable
 */
function toConfidencePercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

/**
 * Accepts both the raw Rekognition shape ({ Name, ParentName, Confidence,
 * Categories: [{ Name }] }) and an already-normalised label, and returns a
 * stable, JSON-safe representation that is safe to persist in JSONB.
 *
 * @param {Array} labels
 * @returns {Array<{name: string, family: string, confidence: number, categories: string[]}>}
 */
function normaliseLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((label) => label && typeof label === "object")
    .map((label) => {
      const name = String(label.name ?? label.Name ?? "").trim();
      const parent = String(label.family ?? label.Family ?? label.ParentName ?? "").trim();
      const categories = Array.isArray(label.categories ?? label.Categories)
        ? (label.categories ?? label.Categories)
          .map((category) =>
            category && typeof category === "object"
              ? String(category.name ?? category.Name ?? "").trim()
              : String(category).trim(),
          )
          .filter(Boolean)
        : [];
      return {
        name,
        family: parent || name.split("/")[0].trim(),
        confidence: toConfidencePercent(label.confidence ?? label.Confidence),
        categories,
      };
    })
    .filter((label) => label.name !== "");
}

/**
 * Does this label belong to one of the auto-reject families?
 * Rekognition nests names ("Explicit Nudity/Graphic Nudity") and exposes the
 * family via ParentName, so both the family and every path segment are checked
 * case-insensitively.
 *
 * @param {{name: string, family: string}} label
 * @param {string[]} families
 * @returns {boolean}
 */
function labelInFamilies(label, families) {
  const candidates = [label.family, ...String(label.name || "").split("/")]
    .map(normaliseFamily)
    .filter(Boolean);
  return families
    .map(normaliseFamily)
    .filter(Boolean)
    .some((family) => candidates.some((candidate) => candidate === family || candidate.startsWith(`${family} `)));
}

// ── Pure decision logic (no I/O — the part worth unit-testing hardest) ───────

/**
 * Turn a moderation result into a publish/reject/flag decision.
 *
 * Rules (acceptance criteria #1101):
 *   - any label whose family is in `rejectFamilies` (default: Explicit Nudity,
 *     Violence) with confidence STRICTLY ABOVE `rejectAbove` (default 70)
 *     → "rejected"
 *   - otherwise any other label at or above `reviewAtLeast` (default 50)
 *     → "pending_review" (admin queue, still publishable)
 *   - otherwise → "approved"
 *
 * @param {{labels?: Array}|Array} result  normalised result, or a bare label array
 * @param {object} [opts]
 * @param {number} [opts.rejectAbove]     reject threshold in percent
 * @param {number} [opts.reviewAtLeast]   review threshold in percent
 * @param {string[]} [opts.rejectFamilies]
 * @returns {{status: string, reason: string|null, maxConfidence: number,
 *            labels: Array, triggeringLabels: Array, reviewLabels: Array,
 *            flaggedForReview: boolean}}
 */
function evaluateModerationResult(result, opts = {}) {
  const config = getModerationConfig();
  const rejectAbove = Number.isFinite(Number(opts.rejectAbove ?? opts.rejectConfidence))
    ? toConfidencePercent(opts.rejectAbove ?? opts.rejectConfidence)
    : config.rejectConfidence;
  const reviewAtLeast = Number.isFinite(Number(opts.reviewAtLeast ?? opts.reviewConfidence))
    ? toConfidencePercent(opts.reviewAtLeast ?? opts.reviewConfidence)
    : config.reviewConfidence;
  const families = Array.isArray(opts.rejectFamilies) ? opts.rejectFamilies : config.rejectFamilies;

  const labels = normaliseLabels(Array.isArray(result) ? result : result && result.labels);

  const triggeringLabels = [];
  const reviewLabels = [];
  let maxConfidence = 0;

  for (const label of labels) {
    if (label.confidence > maxConfidence) maxConfidence = label.confidence;
    if (labelInFamilies(label, families) && label.confidence > rejectAbove) {
      triggeringLabels.push(label);
    } else if (label.confidence >= reviewAtLeast) {
      reviewLabels.push(label);
    }
  }

  const format = (label) => `"${label.name}" at ${label.confidence}% confidence`;

  if (triggeringLabels.length > 0) {
    const worst = triggeringLabels.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    return {
      status: STATUS.REJECTED,
      reason:
        `Image auto-rejected: ${format(worst)} exceeds the ${rejectAbove}% limit for ` +
        `${worst.family || worst.name.split("/")[0]} content.`,
      maxConfidence,
      labels,
      triggeringLabels,
      reviewLabels,
      flaggedForReview: false,
    };
  }

  if (reviewLabels.length > 0) {
    const worst = reviewLabels.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    return {
      status: STATUS.PENDING_REVIEW,
      reason:
        `Flagged for manual review: ${format(worst)} is above the ${reviewAtLeast}% review ` +
        "threshold but not an auto-reject category.",
      maxConfidence,
      labels,
      triggeringLabels,
      reviewLabels,
      flaggedForReview: true,
    };
  }

  return {
    status: STATUS.APPROVED,
    reason: null,
    maxConfidence,
    labels,
    triggeringLabels,
    reviewLabels,
    flaggedForReview: false,
  };
}

// ── Rekognition call ─────────────────────────────────────────────────────────

/**
 * Scan one image with AWS Rekognition `DetectModerationLabels`.
 *
 * Two input forms, in order of preference:
 *   - `{ bucket, key }`  → S3Object form. No bytes cross this server; used at
 *     publish time and for presigned (direct-to-S3) uploads.
 *   - `{ bytes }`        → ImageContent form. Used right after a multipart
 *     upload, while the buffer is already in memory.
 *
 * @param {{bucket?: string, key?: string, bytes?: Buffer}} input
 * @returns {Promise<{labels: Array, provider: string, source: string,
 *                    bucket: string|null, key: string|null}>}
 * @throws {ModerationUnavailableError} on missing SDK, bad input, or API errors
 */
async function detectUnsafeContent(input = {}) {
  const { bucket, key, bytes } = input;
  const useBytes = Buffer.isBuffer(bytes) && bytes.length > 0;

  if (!useBytes && !(bucket && key)) {
    throw new ModerationUnavailableError(
      "detectUnsafeContent requires either { bucket, key } or image bytes",
    );
  }

  const { client, DetectModerationLabelsCommand } = module.exports.createRekognitionClient();

  const image = useBytes
    ? { ImageContent: { Bytes: bytes } }
    : { S3Object: { Bucket: bucket, Name: key } };

  let response;
  try {
    response = await client.send(new DetectModerationLabelsCommand(image));
  } catch (err) {
    throw new ModerationUnavailableError(
      `Rekognition DetectModerationLabels failed: ${err && err.message ? err.message : "unknown error"}`,
      err,
    );
  }

  const rawLabels = response && Array.isArray(response.Labels) ? response.Labels : [];
  return {
    provider: PROVIDER,
    source: useBytes ? "rekognition_image_bytes" : "rekognition_s3_object",
    bucket: useBytes ? null : bucket,
    key: useBytes ? null : key,
    labels: normaliseLabels(rawLabels),
    // ModerationModelVersion is informational only; never throw on its absence.
    modelVersion: (response && response.ModerationModelVersion) || null,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Row lookup for the latest decision about an object. Used to avoid paying for
 * a second Rekognition scan of an image already scanned at upload time, and to
 * make sure an image that was auto-rejected can never be published.
 *
 * @param {{storageKey?: string, imageUrl?: string}} target
 * @returns {Promise<object|null>} mapped row or null
 */
async function getLatestModerationDecision(target = {}) {
  const storageKey = typeof target.storageKey === "string" ? target.storageKey.trim() : "";
  const imageUrl = typeof target.imageUrl === "string" ? target.imageUrl.trim() : "";
  if (!storageKey && !imageUrl) return null;

  const clauses = [];
  const params = [];
  if (storageKey) {
    params.push(storageKey);
    clauses.push(`storage_key = $${params.length}`);
  }
  if (imageUrl) {
    params.push(imageUrl);
    clauses.push(`image_url = $${params.length}`);
  }

  // eslint-disable-next-line sql-injection/no-sql-injection
  const sql = `
    SELECT id, update_id, project_id, storage_key, image_url, status,
           flagged_for_review, provider, max_confidence, moderation_labels,
           reason, created_at
      FROM update_images
     WHERE ${clauses.join(" OR ")}
     ORDER BY created_at DESC
     LIMIT 1`;

  const result = await pool.query(sql, params);
  const row = result && result.rows && result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    updateId: row.update_id,
    projectId: row.project_id,
    storageKey: row.storage_key,
    imageUrl: row.image_url,
    status: row.status,
    flaggedForReview: !!row.flagged_for_review,
    provider: row.provider,
    maxConfidence: row.max_confidence === null ? null : Number(row.max_confidence),
    labels: Array.isArray(row.moderation_labels) ? row.moderation_labels : [],
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/**
 * Persist a moderation decision (acceptance criterion: "Log moderation decisions
 * in the update_images table"). Never rejects: the audit write must not be able
 * to change the HTTP outcome of a route, so failures are logged instead.
 *
 * @param {object} decision
 * @returns {Promise<string|null>} the new row id, or null when logging failed
 */
async function recordModerationDecision(decision = {}) {
  const labels = normaliseLabels(decision.labels);
  const status = Object.values(STATUS).includes(decision.status) ? decision.status : STATUS.PENDING_REVIEW;
  const maxConfidence =
    decision.maxConfidence === null || decision.maxConfidence === undefined
      ? null
      : toConfidencePercent(decision.maxConfidence);

  const id = uuidv4();
  const params = [
    id,
    decision.updateId || null,
    decision.projectId || null,
    decision.storageKey || null,
    String(decision.imageUrl || "").slice(0, 2048),
    decision.storageBackend || (decision.storageKey ? "s3" : "unknown"),
    status,
    decision.flaggedForReview === undefined ? status === STATUS.PENDING_REVIEW : !!decision.flaggedForReview,
    decision.provider || PROVIDER,
    maxConfidence,
    JSON.stringify(labels),
    decision.reason ? String(decision.reason).slice(0, 2000) : null,
  ];

  try {
    await pool.query(
      `INSERT INTO update_images (
         id, update_id, project_id, storage_key, image_url, storage_backend,
         status, flagged_for_review, provider, max_confidence, moderation_labels,
         reason, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      params,
    );

    logger.info(
      {
        event: "image_moderation_decision_logged",
        decision_id: id,
        update_id: params[1],
        project_id: params[2],
        storage_key: params[3],
        status,
        max_confidence: maxConfidence,
        flagged_for_review: params[7],
        labels: labels.map((label) => `${label.name}:${label.confidence}`),
      },
      "Recorded image moderation decision",
    );
    return id;
  } catch (err) {
    logger.error(
      {
        event: "image_moderation_decision_log_failed",
        status,
        storage_key: params[3],
        image_url: params[4],
        err: err.message,
      },
      "Failed to persist an image moderation decision to update_images",
    );
    return null;
  }
}

/**
 * Back-fill update_id/project_id on a decision that was recorded earlier, at
 * upload time, when no update row existed yet.
 *
 * @param {{decisionId: string, updateId?: string, projectId?: string}} link
 * @returns {Promise<boolean>} true when the row was linked
 */
async function attachDecisionToUpdateImage(link = {}) {
  if (!link.decisionId) return false;
  try {
    await pool.query(
      `UPDATE update_images
          SET update_id = COALESCE($2, update_id),
              project_id = COALESCE($3, project_id),
              updated_at = NOW()
        WHERE id = $1`,
      [link.decisionId, link.updateId || null, link.projectId || null],
    );
    return true;
  } catch (err) {
    logger.error(
      {
        event: "image_moderation_link_failed",
        decision_id: link.decisionId,
        update_id: link.updateId,
        err: err.message,
      },
      "Failed to link an update_images decision to its project update",
    );
    return false;
  }
}

// ── Bucket / key resolution ──────────────────────────────────────────────────

/**
 * Recognise an AWS S3 endpoint host without a backtracking regex (the security
 * lint flags nested optional groups on user-supplied input).
 *
 *   bucket.s3.amazonaws.com            → { bucket: "bucket" }
 *   bucket.s3.us-east-1.amazonaws.com  → { bucket: "bucket" }
 *   bucket.s3.dualstack.eu-west-1…     → { bucket: "bucket" }
 *   s3.amazonaws.com / s3.<region>…     → { bucket: "" }  (path style)
 *   anything else                       → null
 *
 * @param {string} hostname
 * @returns {{bucket: string}|null}
 */
function bucketFromAwsHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  const suffix = ".amazonaws.com";
  if (!host.endsWith(suffix)) return null;

  const parts = host.slice(0, -suffix.length).split(".");
  const s3Index = parts.indexOf("s3");
  if (s3Index === -1) return null;

  return { bucket: parts.slice(0, s3Index).join(".") };
}

/**
 * Map a stored-image URL back to its S3 bucket + object key.
 *
 * Accepted shapes:
 *   - ${S3_PUBLIC_URL}/<key>                       (CloudFront/custom domain)
 *   - https://<bucket>.s3[.<region>].amazonaws.com/<key>
 *   - https://s3[.<region>].amazonaws.com/<bucket>/<key>
 *   (storage.js builds the second form; the region-less and dualstack variants
 *   are accepted too.)
 *
 * Returns null for anything else (external CDNs, the local backend's
 * /api/uploads/<key> path) — callers must not attempt to scan URLs they do not
 * own, which would mean fetching arbitrary user-supplied addresses.
 *
 * @param {string} imageUrl
 * @returns {{bucket: string, key: string}|null}
 */
function resolveStoredImageLocation(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) return null;

  let parsed;
  try {
    parsed = new URL(imageUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const pathname = (() => {
    try {
      return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    } catch {
      return parsed.pathname.replace(/^\/+/, "");
    }
  })();
  if (!pathname) return null;

  const configuredBucket = process.env.S3_BUCKET || "";
  const publicBaseUrl = (process.env.S3_PUBLIC_URL || "").replace(/\/+$/, "");

  if (publicBaseUrl && configuredBucket) {
    let publicUrl;
    try {
      publicUrl = new URL(publicBaseUrl);
    } catch {
      publicUrl = null;
    }
    if (publicUrl && publicUrl.host === parsed.host) {
      // S3_PUBLIC_URL may carry a path prefix (e.g. a CloudFront distribution
      // serving the bucket under /public) — strip it before reading the key.
      const prefix = publicUrl.pathname.replace(/^\/+|\/+$/g, "");
      const bare = pathname.replace(/^\/+/, "");
      const key = !prefix
        ? bare
        : bare.startsWith(`${prefix}/`)
          ? bare.slice(prefix.length + 1)
          : bare;
      return key ? { bucket: configuredBucket, key } : null;
    }
  }

  const awsHost = bucketFromAwsHost(parsed.hostname);
  if (awsHost && awsHost.bucket) {
    // Virtual-hosted style: https://<bucket>.s3[.<region>].amazonaws.com/<key>
    if (!configuredBucket || awsHost.bucket === configuredBucket) {
      return { bucket: awsHost.bucket, key: pathname };
    }
    return null;
  }

  if (awsHost) {
    // Path style: https://s3[.<region>].amazonaws.com/<bucket>/<key>
    const slash = pathname.indexOf("/");
    const bucket = slash === -1 ? pathname : pathname.slice(0, slash);
    const key = slash === -1 ? "" : pathname.slice(slash + 1);
    if (key && (!configuredBucket || bucket === configuredBucket)) {
      return { bucket, key };
    }
  }

  return null;
}

/**
 * Storage key for an image URL owned by this deployment (null otherwise).
 * @param {string} imageUrl
 * @returns {string|null}
 */
function storageKeyFromUrl(imageUrl) {
  const location = resolveStoredImageLocation(imageUrl);
  return location ? location.key : null;
}

// ── Orchestration used by the routes ─────────────────────────────────────────

function skippedVerdict(reason) {
  return {
    applied: false,
    blocked: false,
    status: OUTCOME.SKIPPED,
    reason: null,
    skipReason: reason,
    maxConfidence: null,
    labels: [],
    flaggedForReview: false,
    newDecision: false,
    decisionId: null,
    provider: null,
  };
}

/**
 * Apply the configured failure policy (see the header comment).
 *
 * @param {object} config
 * @param {string} message
 * @param {object} target { imageUrl, storageKey, bucket }
 * @param {object} [extra] fields carried over verbatim (storageBackend, bucket…)
 */
function failureVerdict(config, message, target, extra = {}) {
  const detail = `Image could not be scanned (${message}).`;
  logger.warn(
    {
      event: "image_moderation_unavailable",
      fail_mode: config.failMode,
      image_url: target.imageUrl,
      storage_key: target.storageKey,
      err: message,
    },
    "Image moderation unavailable — applying configured fail mode",
  );

  if (config.failMode === "closed") {
    return {
      ...extra,
      applied: true,
      blocked: true,
      status: OUTCOME.UNAVAILABLE,
      reason: detail,
      maxConfidence: null,
      labels: [],
      flaggedForReview: false,
      newDecision: false,
      decisionId: null,
      provider: PROVIDER,
      imageUrl: target.imageUrl || null,
      storageKey: target.storageKey || null,
      bucket: target.bucket || null,
    };
  }

  // fail-open: publish it, but never silently.
  return {
    ...extra,
    applied: true,
    blocked: false,
    status: STATUS.PENDING_REVIEW,
    reason: `Fail-open: ${detail} Queued for manual admin review.`,
    maxConfidence: null,
    labels: [],
    flaggedForReview: true,
    newDecision: true,
    decisionId: null,
    provider: PROVIDER,
    imageUrl: target.imageUrl || null,
    storageKey: target.storageKey || null,
    bucket: target.bucket || null,
  };
}

/**
 * Scan an update image and reduce it to a route-level verdict.
 *
 * @param {object} opts
 * @param {string}  [opts.imageUrl]  public URL of the stored image
 * @param {string}  [opts.bucket]    S3 bucket (defaults to process.env.S3_BUCKET)
 * @param {string}  [opts.key]       S3 object key (skips URL resolution)
 * @param {Buffer}  [opts.bytes]     in-memory bytes — preferred when available
 * @param {string}  [opts.storageBackend] "s3" | "local" | ...
 * @returns {Promise<{applied: boolean, blocked: boolean, status: string,
 *   reason: string|null, maxConfidence: number|null, labels: Array,
 *   flaggedForReview: boolean, newDecision: boolean, decisionId: string|null,
 *   imageUrl: string|null, storageKey: string|null, bucket: string|null,
 *   storageBackend: string, provider: string|null}>}
 */
async function moderateImage(opts = {}) {
  const config = getModerationConfig();
  const imageUrl = typeof opts.imageUrl === "string" ? opts.imageUrl.trim() : "";
  const storageBackend = opts.storageBackend || "s3";
  const bytes = Buffer.isBuffer(opts.bytes) && opts.bytes.length > 0 ? opts.bytes : null;

  const target = {
    imageUrl: imageUrl || null,
    storageKey: typeof opts.key === "string" && opts.key.trim() ? opts.key.trim() : null,
    bucket: opts.bucket || process.env.S3_BUCKET || null,
  };
  const base = { storageBackend, imageUrl: target.imageUrl, storageKey: target.storageKey, bucket: target.bucket };

  if (!config.enabled) return { ...skippedVerdict("disabled"), ...base };
  if (!isModerationConfigured()) return { ...skippedVerdict("not_configured"), ...base };

  if (!bytes) {
    if (!target.storageKey || !target.bucket) {
      const location = resolveStoredImageLocation(imageUrl);
      if (!location) {
        return failureVerdict(
          config,
          "image URL does not point at the configured S3 bucket",
          target,
          base,
        );
      }
      target.storageKey = location.key;
      target.bucket = location.bucket;
    }

    try {
      const prior = await getLatestModerationDecision({
        storageKey: target.storageKey,
        imageUrl: target.imageUrl,
      });
      if (prior && Object.values(STATUS).includes(prior.status)) {
        return {
          ...base,
          applied: true,
          blocked: prior.status === STATUS.REJECTED,
          status: prior.status,
          reason: prior.reason,
          maxConfidence: prior.maxConfidence,
          labels: prior.labels,
          flaggedForReview: prior.flaggedForReview,
          newDecision: false,
          decisionId: prior.id,
          provider: prior.provider,
          reusedPriorDecision: true,
        };
      }
    } catch (err) {
      // A missing table/DB outage must not crash the route, but under
      // fail-closed it must not publish an unscanned image either.
      return failureVerdict(config, `decision lookup failed: ${err.message}`, target, base);
    }
  }

  try {
    const result = await detectUnsafeContent({
      bucket: bytes ? null : target.bucket,
      key: bytes ? null : target.storageKey,
      bytes,
    });
    const decision = evaluateModerationResult(result, config);
    target.bucket = result.bucket || target.bucket;
    target.storageKey = result.key || target.storageKey;
    return {
      ...base,
      bucket: target.bucket,
      storageKey: target.storageKey,
      applied: true,
      blocked: decision.status === STATUS.REJECTED,
      status: decision.status,
      reason: decision.reason,
      maxConfidence: decision.maxConfidence,
      labels: decision.labels,
      flaggedForReview: decision.flaggedForReview,
      newDecision: true,
      decisionId: null,
      provider: PROVIDER,
      reusedPriorDecision: false,
    };
  } catch (err) {
    return failureVerdict(
      config,
      err && err.message ? err.message : "unknown moderation error",
      target,
      base,
    );
  }
}

/**
 * Public summary of a verdict for HTTP responses (never the raw label dump).
 * @param {object} verdict
 */
function moderationSummary(verdict) {
  if (!verdict || !verdict.applied) return undefined;
  return {
    status: verdict.status,
    flaggedForReview: !!verdict.flaggedForReview,
    maxConfidence: verdict.maxConfidence,
    provider: verdict.provider,
    reason: verdict.reason,
  };
}

/**
 * Best-effort removal of a rejected object from S3 so an auto-rejected image is
 * not left publicly readable. Failures are logged, never thrown.
 *
 * @param {{bucket?: string, key?: string}} object
 * @returns {Promise<boolean>} true when the object was deleted
 */
async function deleteRejectedObject(object = {}) {
  const { bucket, key } = object;
  if (!bucket || !key) return false;

  let sdk;
  try {
    // eslint-disable-next-line global-require
    sdk = require("@aws-sdk/client-s3");
  } catch (err) {
    logger.warn(
      { event: "image_moderation_cleanup_sdk_missing", err: err.message },
      "Cannot delete a rejected image object — @aws-sdk/client-s3 unavailable",
    );
    return false;
  }

  try {
    const s3 = new sdk.S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    await s3.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    logger.info(
      { event: "image_moderation_object_deleted", bucket, key },
      "Deleted auto-rejected image from storage",
    );
    return true;
  } catch (err) {
    logger.error(
      { event: "image_moderation_object_delete_failed", bucket, key, err: err.message },
      "Failed to delete an auto-rejected image — it may still be publicly reachable",
    );
    return false;
  }
}

module.exports = {
  // constants
  PROVIDER,
  STATUS,
  OUTCOME,
  DEFAULTS,
  ModerationUnavailableError,
  // config
  getModerationConfig,
  isModerationConfigured,
  isModerationEnforced,
  // pure logic
  evaluateModerationResult,
  normaliseLabels,
  toConfidencePercent,
  labelInFamilies,
  resolveStoredImageLocation,
  storageKeyFromUrl,
  moderationSummary,
  // AWS seams (lazy requires)
  createRekognitionClient,
  detectUnsafeContent,
  deleteRejectedObject,
  // persistence
  getLatestModerationDecision,
  recordModerationDecision,
  attachDecisionToUpdateImage,
  // orchestration
  moderateImage,
};
