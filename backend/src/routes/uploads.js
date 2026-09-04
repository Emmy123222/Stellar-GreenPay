/**
 * src/routes/uploads.js — Document upload endpoints
 *
 * POST /api/uploads (multipart/form-data, field name `file`)
 *   - Validates: file presence, size (max 10 MB by default), and file type.
 *   - Uses magic bytes (file signatures) to detect actual file type,
 *     preventing spoofed Content-Type attacks where attackers upload
 *     executable code labeled as image/pdf.
 *   - Storages the file via storage.uploadFile() and returns:
 *       { success: true, data: { key, url, size, contentType, backend } }
 *   - Errors that map to user-facing 400/413 responses are returned with
 *     a `code` field so the frontend can show specific copy.
 *
 * POST /api/uploads/presign
 *   - Returns a short-lived presigned S3 PUT URL for direct client-to-S3
 *     uploads, avoiding routing file bytes through this server.
 *   - Request body (JSON): { originalName, contentType, size? }
 *   - Response: { success: true, data: { key, url, expiry } }
 *   - Falls back with 503 when STORAGE_BACKEND is not "s3" or S3 credentials
 *     are absent — callers should fall back to POST /api/uploads in that case.
 *
 * GET /api/uploads/:key
 *   - Serves files written by the local backend from backend/uploads/<key>.
 *   - Sets Content-Disposition: attachment so browsers prompt a download
 *     instead of rendering PDFs/images inline (issue #696).
 *   - Other backends simply point callers at absolute URLs, so this
 *     static-serve route returns 404 by design for non-local backends.
 *
 * SECURITY:
 *   - File type detection is based on magic bytes (file signatures) via
 *     the file-type library, not on client-supplied Content-Type headers.
 *   - This prevents attacks where Content-Type is spoofed to bypass
 *     MIME-type validation (e.g., uploading a .php file as image/png).
 */
"use strict";

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { uploadFile, backendName, UPLOAD_DIR } = require("../services/storage");
const { generatePresignedPutUrl, isS3Configured } = require("../services/s3Presign");
const { createRateLimiter } = require("../middleware/rateLimiter");
const logger = require("../logger");

const uploadRateLimiter = createRateLimiter(20, 15, "uploads"); // 20 uploads per 15 min

const MAX_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES || String(10 * 1024 * 1024), 10);

/**
 * Allowed MIME types based on detected file content (magic bytes), not
 * on client-supplied Content-Type header. This prevents attacks that
 * spoof the Content-Type header to upload executable files.
 */
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

const memory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

/**
 * Detects the actual MIME type of a file buffer by examining magic bytes
 * (file signatures) rather than trusting client-supplied Content-Type.
 *
 * @param {Buffer} buffer - File content
 * @returns {Promise<string|null>} - Detected MIME type or null if unknown
 */
async function detectMimeType(buffer) {
  try {
    if (!buffer || buffer.length === 0) return null;
    const { fileTypeFromBuffer } = await import("file-type");
    const type = await fileTypeFromBuffer(buffer);
    return type ? type.mime : null;
  } catch (err) {
    logger.warn(
      { event: "file_type_detection_error", err: err.message },
      "Error detecting file type from magic bytes"
    );
    return null;
  }
}

router.post("/", uploadRateLimiter, (req, res, next) => {
  memory.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `File too large. Maximum size is ${MAX_BYTES / (1024 * 1024)} MB.`,
        });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return next(err);

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use the 'file' multipart field." });
    }

    // Detect MIME type from magic bytes, not from client-supplied Content-Type
    const detectedMimeType = await detectMimeType(req.file.buffer);

    // If we can't detect the MIME type from magic bytes, reject the file.
    // This prevents uploads of unrecognized or corrupted files.
    if (!detectedMimeType) {
      logger.warn(
        {
          event: "file_upload_rejected_unknown_type",
          clientMimeType: req.file.mimetype,
          fileSize: req.file.size,
        },
        "Rejected upload: unable to detect file type from magic bytes"
      );
      return res.status(415).json({
        error: "File type could not be detected. File may be corrupted or use an unsupported format.",
      });
    }

    // Validate detected MIME type against whitelist.
    // Prioritize detected type over client-supplied type to prevent spoofing.
    if (!ALLOWED_MIME.has(detectedMimeType)) {
      logger.warn(
        {
          event: "file_upload_rejected_unsupported_type",
          detectedMimeType,
          clientMimeType: req.file.mimetype,
          fileSize: req.file.size,
        },
        "Rejected upload: detected MIME type not in whitelist"
      );
      return res.status(415).json({
        error: `Unsupported file type: ${detectedMimeType}. Allowed: PDF, images, Office docs, CSV, plain text, ZIP.`,
      });
    }

    // If client-supplied Content-Type differs from detected type, log it as suspicious.
    if (req.file.mimetype && req.file.mimetype !== detectedMimeType) {
      logger.warn(
        {
          event: "file_upload_content_type_mismatch",
          detectedMimeType,
          clientMimeType: req.file.mimetype,
          originalName: req.file.originalname,
        },
        "Uploaded file Content-Type header does not match detected MIME type"
      );
    }

    try {
      const stored = await uploadFile(req.file.buffer, req.file.originalname, detectedMimeType);
      res.status(201).json({
        success: true,
        data: {
          ...stored,
          originalName: req.file.originalname,
        },
      });
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
});

/**
 * POST /api/uploads/presign
 *
 * Returns a short-lived presigned S3 PUT URL. The client uploads the file
 * directly to S3; no file bytes pass through this server.
 *
 * Request body (JSON):
 *   {
 *     "originalName": "report.pdf",    // required — original filename
 *     "contentType":  "application/pdf", // required — MIME type
 *     "size":         102400             // optional — bytes; validated ≤ UPLOAD_MAX_BYTES
 *   }
 *
 * Success response 200:
 *   {
 *     "success": true,
 *     "data": {
 *       "key":    "<s3-object-key>",
 *       "url":    "<presigned-PUT-url>",
 *       "expiry": 1234567890           // Unix timestamp (seconds)
 *     }
 *   }
 *
 * Falls back to 503 when S3 is not configured — the client should retry
 * with a standard POST /api/uploads multipart upload in that case.
 */
const presignRateLimiter = createRateLimiter(30, 15, "upload-presign"); // 30 presign requests per 15 min

router.post("/presign", presignRateLimiter, async (req, res, next) => {
  const { originalName, contentType, size } = req.body || {};

  if (!originalName || typeof originalName !== "string" || !originalName.trim()) {
    return res.status(400).json({
      error: "originalName is required and must be a non-empty string.",
    });
  }
  if (!contentType || typeof contentType !== "string") {
    return res.status(400).json({
      error: "contentType is required and must be a string.",
    });
  }

  try {
    const result = await generatePresignedPutUrl({
      originalName: originalName.trim(),
      contentType: contentType.trim(),
      size,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    // Map service-layer statusCodes to HTTP responses
    const status = err.statusCode;
    if (status === 400 || status === 413 || status === 503) {
      return res.status(status).json({
        error: err.message,
        ...(status === 503 && {
          fallback: "Use POST /api/uploads for a standard multipart upload.",
        }),
      });
    }
    // Unexpected errors go to the central error handler
    return next(err);
  }
});

/**
 * Derive a safe Content-Disposition header value from a storage key.
 *
 * Keys are built by storage.js as "<24-char hex>-<sanitized-original-name>",
 * e.g. "a1b2c3d4e5f6a1b2c3d4e5f6-report_2026.pdf".
 * We strip the hex prefix to recover the original filename, then emit both
 * an ASCII quoted-string fallback (for older UAs) and an RFC 5987
 * percent-encoded filename* parameter (for full Unicode support).
 *
 * @param {string} key - URL-decoded storage key from req.params.key.
 * @returns {string} Complete Content-Disposition header value.
 */
function buildContentDisposition(key) {
  const match = key.match(/^[0-9a-f]{24}-(.+)$/i);
  const filename = match ? match[1] : key;

  // ASCII fallback: replace anything outside printable ASCII and RFC 6266
  // forbidden chars (double-quote, backslash) with underscores.
  const asciiFilename = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");

  // RFC 5987 value for full Unicode filenames.
  const encodedFilename = encodeURIComponent(filename).replace(/'/g, "%27");

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

/**
 * Serve files persisted by the "local" backend. S3/IPFS callers
 * should use the URLs returned at upload time — this route only exists
 * for the local fallback to make documents reachable from the browser.
 */
router.get("/:key", (req, res) => {
  if (backendName() !== "local") {
    return res.status(404).json({ error: "Static serving disabled for this storage backend" });
  }
  const key = req.params.key;
  // Defence-in-depth: never let a path traversal escape the uploads dir.
  if (key.includes("/") || key.includes("..")) {
    return res.status(400).json({ error: "Invalid key" });
  }
  const fullPath = path.join(UPLOAD_DIR, key);
  if (!fullPath.startsWith(UPLOAD_DIR + path.sep) && fullPath !== UPLOAD_DIR) {
    return res.status(400).json({ error: "Invalid key" });
  }
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "File not found" });
  }
  // Issue #696 — prompt download instead of inline rendering.
  res.setHeader("Content-Disposition", buildContentDisposition(key));
  res.sendFile(fullPath);
});

module.exports = router;
