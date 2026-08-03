/**
 * src/services/s3Presign.js — S3 presigned PUT URL generator
 *
 * Generates a short-lived presigned S3 PUT URL so clients can upload
 * files directly to S3 without routing bytes through the backend server.
 *
 * Usage:
 *   const { generatePresignedPutUrl, isS3Configured } = require('./s3Presign');
 *
 *   const { key, url, expiry } = await generatePresignedPutUrl({
 *     originalName: 'report.pdf',
 *     contentType:  'application/pdf',
 *     size:         102400,          // optional — validated against UPLOAD_MAX_BYTES
 *   });
 *
 * Environment variables (all required when STORAGE_BACKEND=s3):
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET
 * Optional:
 *   PRESIGN_EXPIRY_SECONDS   — how long the URL is valid (default: 300 s / 5 min)
 *
 * The service performs no I/O beyond signing — no DB writes, no HEAD requests
 * to S3. Callers are responsible for recording the key after the client
 * confirms the upload was successful.
 */
"use strict";

const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const logger = require("../logger");

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_SECONDS = 300; // 5 minutes

/** MIME types accepted by the presign endpoint (mirrors the multipart uploader). */
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/zip",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitise an original filename and combine it with a random hex prefix to
 * produce a key safe for S3 object names (no directory traversal, length
 * bounded to 80 visible chars).
 *
 * @param {string} originalName
 * @returns {string}
 */
function buildKey(originalName) {
  const sanitized = String(originalName || "upload")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const id = crypto.randomBytes(12).toString("hex");
  return `${id}-${sanitized}`;
}

/**
 * Returns true when all required S3 env vars are present.
 *
 * @returns {boolean}
 */
function isS3Configured() {
  return !!(
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET
  );
}

/**
 * Build an S3Client from environment variables. Exported so tests can spy on it.
 *
 * @returns {S3Client}
 */
function createS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PresignResult
 * @property {string} key       - S3 object key the client must PUT to.
 * @property {string} url       - Presigned PUT URL (short-lived).
 * @property {number} expiry    - Unix timestamp (seconds) when the URL expires.
 */

/**
 * Generate a presigned S3 PUT URL for direct client-to-S3 upload.
 *
 * @param {object}  opts
 * @param {string}  opts.originalName  - Original filename from the client.
 * @param {string}  opts.contentType   - MIME type of the file to be uploaded.
 * @param {number}  [opts.size]        - File size in bytes (validated against
 *                                       UPLOAD_MAX_BYTES when supplied).
 * @returns {Promise<PresignResult>}
 * @throws {Error} with a `.statusCode` property (400/413/503/500) so the route
 *                 handler can map it to an appropriate HTTP response.
 */
async function generatePresignedPutUrl({ originalName, contentType, size }) {
  // ── Validate content type ──────────────────────────────────────────────────
  if (!contentType || !ALLOWED_MIME.has(contentType)) {
    const err = new Error(
      `Unsupported content type: ${contentType}. ` +
        "Allowed: PDF, images, Office docs, CSV, plain text, ZIP."
    );
    err.statusCode = 400;
    throw err;
  }

  // ── Validate size (optional) ───────────────────────────────────────────────
  const maxBytes = parseInt(
    process.env.UPLOAD_MAX_BYTES || String(10 * 1024 * 1024),
    10
  );
  if (size !== undefined && size !== null) {
    const sizeNum = Number(size);
    if (!Number.isFinite(sizeNum) || sizeNum < 0) {
      const err = new Error(
        "Invalid size parameter — must be a non-negative integer."
      );
      err.statusCode = 400;
      throw err;
    }
    if (sizeNum > maxBytes) {
      const err = new Error(
        `File too large. Maximum size is ${maxBytes / (1024 * 1024)} MB.`
      );
      err.statusCode = 413;
      throw err;
    }
  }

  // ── S3 availability check ──────────────────────────────────────────────────
  if (!isS3Configured()) {
    logger.warn(
      { event: "presign_s3_not_configured" },
      "POST /api/uploads/presign called but S3 is not configured"
    );
    const err = new Error(
      "Presigned uploads require STORAGE_BACKEND=s3. " +
        "Use POST /api/uploads for a standard upload."
    );
    err.statusCode = 503;
    throw err;
  }

  // ── Build key & sign ───────────────────────────────────────────────────────
  const key = buildKey(originalName);
  const expirySeconds = Math.max(
    1,
    parseInt(
      process.env.PRESIGN_EXPIRY_SECONDS || String(DEFAULT_EXPIRY_SECONDS),
      10
    )
  );

  const client = createS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  let signedUrl;
  try {
    signedUrl = await getSignedUrl(client, command, { expiresIn: expirySeconds });
  } catch (sdkErr) {
    logger.error(
      { event: "presign_sdk_error", err: sdkErr.message },
      "Failed to generate presigned URL"
    );
    const wrappedErr = new Error("Failed to generate upload URL. Please try again.");
    wrappedErr.statusCode = 500;
    throw wrappedErr;
  }

  const expiry = Math.floor(Date.now() / 1000) + expirySeconds;

  logger.info(
    { event: "presign_url_generated", key, expirySeconds },
    "Presigned PUT URL issued"
  );

  return { key, url: signedUrl, expiry };
}

module.exports = {
  generatePresignedPutUrl,
  isS3Configured,
  buildKey,
  ALLOWED_MIME,
};
