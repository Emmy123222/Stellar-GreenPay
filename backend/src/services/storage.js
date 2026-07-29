/**
 * src/services/storage.js — Document storage abstraction
 *
 * Verification request forms accept supporting documents (PDFs, images,
 * spreadsheets). This service normalises upload handling so the same
 * `uploadFile()` contract works regardless of which backend is configured:
 *
 *   - "local"   (default)  → writes to backend/uploads/<key> and returns a
 *                            static URL served by GET /api/uploads/<key>.
 *                            No external credentials required.
 *   - "s3"     → uploads to a configured S3-compatible bucket using the
 *                AWS SDK; requires AWS_REGION, AWS_ACCESS_KEY_ID,
 *                AWS_SECRET_ACCESS_KEY, S3_BUCKET, optionally S3_PUBLIC_URL.
 *   - "ipfs"   → POSTs a multipart file to IPFS_API_URL (/api/v0/add).
 *                Requires an IPFS_API_URL (Infura, Pinata cluster, or local
 *                IPFS daemon). Returns the content identifier (CID); the
 *                gateway URL is derived from IPFS_GATEWAY_URL or
 *                https://ipfs.io/ipfs/<cid>.
 *
 * The active backend is selected by STORAGE_BACKEND env var. If
 * STORAGE_BACKEND is "s3" or "ipfs" but the required credentials or
 * endpoint are missing, we fall back to local storage and log a warning
 * so uploads still succeed (a misconfigured production environment
 * shouldn't silently drop submissions).
 *
 * LIMITATIONS:
 *   - These are lightweight, dependency-free adapters. They deliberately
 *     avoid pulling in the full @aws-sdk/client-s3 package to keep the
 *     install footprint small. If you need presigned URLs, multipart
 *     uploads, or KMS encryption, replace the relevant branch with the
 *     official SDK.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("../logger");

const STORAGE_BACKEND = process.env.STORAGE_BACKEND || "local";
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

// Lazy-require AWS SDK so projects that don't use S3 don't need it.
function getAwsS3() {
  // The AWS SDK v3 ships modular packages, so use the bundled v2 client
  // (which is small and works without a build step) when present.
  try {
    // eslint-disable-next-line global-require
    return require("aws-sdk");
  } catch (err) {
    logger.warn(
      { event: "storage_s3_sdk_missing", err: err.message },
      "STORAGE_BACKEND=s3 but aws-sdk is not installed — falling back to local"
    );
    return null;
  }
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function buildKey(originalName) {
  const sanitized = String(originalName || "upload")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const id = crypto.randomBytes(12).toString("hex");
  return `${id}-${sanitized}`;
}

async function uploadLocal(buffer, originalName, contentType) {
  ensureUploadDir();
  const key = buildKey(originalName);
  const fullPath = path.join(UPLOAD_DIR, key);
  await fs.promises.writeFile(fullPath, buffer);
  const url = `/api/uploads/${encodeURIComponent(key)}`;
  return {
    key,
    url,
    size: buffer.length,
    contentType: contentType || "application/octet-stream",
    backend: "local",
  };
}

async function uploadS3(buffer, originalName, contentType) {
  const AWS = getAwsS3();
  if (!AWS) return uploadLocal(buffer, originalName, contentType);

  const required = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.warn(
      { event: "storage_s3_env_missing", missing },
      "STORAGE_BACKEND=s3 but required env vars are missing — falling back to local"
    );
    return uploadLocal(buffer, originalName, contentType);
  }

  const s3 = new AWS.S3({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
  const key = buildKey(originalName);
  await s3
    .putObject({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      ACL: "public-read",
    })
    .promise();
  const publicUrl = process.env.S3_PUBLIC_URL
    ? `${process.env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`
    : `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  return { key, url: publicUrl, size: buffer.length, contentType: contentType || "application/octet-stream", backend: "s3" };
}

async function uploadIpfs(buffer, originalName, contentType) {
  const apiUrl = process.env.IPFS_API_URL;
  if (!apiUrl) {
    logger.warn(
      { event: "storage_ipfs_env_missing" },
      "STORAGE_BACKEND=ipfs but IPFS_API_URL is not set — falling back to local"
    );
    return uploadLocal(buffer, originalName, contentType);
  }

  const FormData = (() => {
    try {
      // Node 18+ has a global FormData/Blob implementation via undici.
      // eslint-disable-next-line global-require
      return globalThis.FormData || require("form-data");
    } catch {
      return null;
    }
  })();
  const BlobCtor = (() => {
    try {
      return globalThis.Blob || require("buffer").Blob;
    } catch {
      return null;
    }
  })();
  if (!FormData || !BlobCtor) {
    logger.warn(
      { event: "storage_ipfs_no_multipart" },
      "IPFS adapter requires Node 18+ global FormData/Blob — falling back to local"
    );
    return uploadLocal(buffer, originalName, contentType);
  }

  const form = new FormData();
  form.append("file", new BlobCtor([buffer]), originalName || "upload");

  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v0/add?wrap-with-directory=false`, {
    method: "POST",
    body: form,
    headers: form.headers ? form.headers : undefined,
  });
  if (!res.ok) {
    throw new Error(`IPFS upload failed: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  // IPFS CLI HTTP API returns newline-delimited JSON.
  const last = text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean)
    .pop();
  if (!last || !last.Hash) {
    throw new Error("IPFS upload succeeded but response did not include a CID");
  }
  const gateway = (process.env.IPFS_GATEWAY_URL || "https://ipfs.io/ipfs").replace(/\/$/, "");
  return {
    key: last.Hash,
    url: `${gateway}/${last.Hash}`,
    size: parseInt(last.Size, 10) || buffer.length,
    contentType: contentType || "application/octet-stream",
    backend: "ipfs",
  };
}

/**
 * Upload a file buffer with metadata, dispatching to the configured backend.
 *
 * @param {Buffer} buffer - File contents.
 * @param {string} originalName - Original filename (sanitised internally).
 * @param {string} contentType - MIME type from the upload.
 * @returns {Promise<{key:string,url:string,size:number,contentType:string,backend:string}>}
 */
async function uploadFile(buffer, originalName, contentType) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("uploadFile requires a Buffer");
  }
  const backend = (STORAGE_BACKEND || "local").toLowerCase();
  if (backend === "s3") return uploadS3(buffer, originalName, contentType);
  if (backend === "ipfs") return uploadIpfs(buffer, originalName, contentType);
  return uploadLocal(buffer, originalName, contentType);
}

function backendName() {
  return STORAGE_BACKEND;
}

module.exports = { uploadFile, backendName, UPLOAD_DIR };
