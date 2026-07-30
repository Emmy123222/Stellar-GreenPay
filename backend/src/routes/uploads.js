/**
 * src/routes/uploads.js — Document upload endpoint
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
 * GET /api/uploads/:key
 *   - Serves files written by the local backend from backend/uploads/<key>.
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
const fileType = require("file-type");
const router = express.Router();
const { uploadFile, backendName, UPLOAD_DIR } = require("../services/storage");
const { createRateLimiter } = require("../middleware/rateLimiter");
const logger = require("../logger");

const uploadRateLimiter = createRateLimiter(20, 15); // 20 uploads per 15 min

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
    const type = await fileType.fromBuffer(buffer);
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
  res.sendFile(fullPath);
});

module.exports = router;
