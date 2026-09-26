"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const { computeBadges } = require("./store");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const logger = require("../logger");

const QUEUE = "profile-update";
const AVATAR_QUEUE = "profile-avatar";
let boss = null;

const MAX_AVATAR_DIMENSION = 256;
const AVATAR_CONTENT_TYPE = "image/webp";

async function processProfileUpdate(donorAddress) {
  const totalResult = await pool.query(
    `SELECT COALESCE(SUM(amount_xlm), 0)::numeric AS total
     FROM donations
     WHERE donor_address = $1
       AND amount_xlm IS NOT NULL`,
    [donorAddress],
  );

  const totalDonatedXlm = parseFloat(totalResult.rows[0]?.total || "0");

  const projectsSupportedResult = await pool.query(
    `SELECT COUNT(DISTINCT project_id) AS count
     FROM donations
     WHERE donor_address = $1`,
    [donorAddress],
  );

  const projectsSupported = Number.parseInt(projectsSupportedResult.rows[0]?.count || "0", 10);
  const badges = computeBadges(totalDonatedXlm);

  const existingProfileResult = await pool.query(
    "SELECT display_name, bio FROM profiles WHERE public_key = $1",
    [donorAddress],
  );

  const existingProfile = existingProfileResult.rows[0] || {};

  await pool.query(
    `INSERT INTO profiles (
       public_key,
       display_name,
       bio,
       total_donated_xlm,
       projects_supported,
       badges,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
     ON CONFLICT (public_key) DO UPDATE SET
       total_donated_xlm = EXCLUDED.total_donated_xlm,
       projects_supported = EXCLUDED.projects_supported,
       badges = EXCLUDED.badges,
       updated_at = EXCLUDED.updated_at`,
    [
      donorAddress,
      existingProfile.display_name || null,
      existingProfile.bio || null,
      totalDonatedXlm.toFixed(7),
      projectsSupported,
      JSON.stringify(badges),
    ],
  );

  return { totalDonatedXLM: totalDonatedXlm.toFixed(7), projectsSupported, badges };
}

function getS3Client() {
  const required = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return null;
  }
  return new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

function getS3Bucket() {
  return process.env.S3_BUCKET;
}

function getS3PublicUrl() {
  return process.env.S3_PUBLIC_URL;
}

const LOCAL_UPLOAD_PREFIX = "/api/uploads/";

// avatarUrl is user-supplied, so a value like "/api/uploads/../../etc/passwd"
// must never resolve outside UPLOAD_DIR (we read AND unlink this path).
function resolveLocalUploadPath(imageUrl, uploadDir = require("./storage").UPLOAD_DIR) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith(LOCAL_UPLOAD_PREFIX)) return null;
  let key;
  try {
    key = decodeURIComponent(imageUrl.slice(LOCAL_UPLOAD_PREFIX.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (!key || key.includes("\0")) return null;
  const root = path.resolve(uploadDir);
  const filePath = path.resolve(root, key);
  if (!filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

// Only objects in our own bucket can be fetched. Returns the S3 key, or null
// for third-party URLs (those are left untouched rather than retried forever).
function resolveOwnS3Key(imageUrl) {
  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  const bucket = getS3Bucket();
  const allowedPrefixes = [];
  if (getS3PublicUrl()) allowedPrefixes.push(getS3PublicUrl().replace(/\/$/, "") + "/");
  if (bucket && process.env.AWS_REGION) {
    allowedPrefixes.push(`https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/`);
  }
  const base = `${url.origin}${url.pathname}`;
  const prefix = allowedPrefixes.find((p) => base.startsWith(p));
  if (!prefix) return null;
  const key = decodeURIComponent(base.slice(prefix.length));
  return key || null;
}

// Avatars we already produced are skipped so re-saving a profile doesn't
// re-encode (and re-upload) an image that is already 256px WebP.
function isProcessedAvatarKey(key) {
  return /^avatars\/[0-9a-f]{24}-[A-Za-z0-9_]+\.webp$/.test(key);
}

async function downloadImageFromUrl(imageUrl) {
  if (!imageUrl) {
    throw new Error("No image URL provided");
  }

  if (imageUrl.startsWith(LOCAL_UPLOAD_PREFIX)) {
    const filePath = resolveLocalUploadPath(imageUrl);
    if (!filePath) {
      throw new Error("Invalid local upload path");
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local file not found: ${filePath}`);
    }
    return fs.promises.readFile(filePath);
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    const s3Client = getS3Client();
    if (!s3Client) {
      throw new Error("S3 not configured for downloading remote image");
    }
    const key = resolveOwnS3Key(imageUrl);
    if (!key) {
      throw new Error("Remote avatar is not hosted in the configured S3 bucket");
    }
    const command = new GetObjectCommand({ Bucket: getS3Bucket(), Key: key });
    const response = await s3Client.send(command);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  throw new Error(`Unsupported image URL format: ${imageUrl}`);
}

async function processAvatarImage(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Invalid image: unable to determine dimensions");
  }

  const needsResize = metadata.width > MAX_AVATAR_DIMENSION || metadata.height > MAX_AVATAR_DIMENSION;

  let processedImage = image;
  if (needsResize) {
    processedImage = image.resize(MAX_AVATAR_DIMENSION, MAX_AVATAR_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const webpBuffer = await processedImage
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  return webpBuffer;
}

function buildAvatarKey(donorAddress) {
  const sanitized = donorAddress.replace(/[^a-zA-Z0-9]/g, "_");
  const id = crypto.randomBytes(12).toString("hex");
  return `avatars/${id}-${sanitized}.webp`;
}

async function uploadAvatarToS3(buffer, key) {
  const s3Client = getS3Client();
  if (!s3Client) {
    throw new Error("S3 not configured");
  }
  const bucket = getS3Bucket();
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: AVATAR_CONTENT_TYPE,
      ACL: "public-read",
    })
  );
  const publicUrl = getS3PublicUrl()
    ? `${getS3PublicUrl().replace(/\/$/, "")}/${key}`
    : `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  return publicUrl;
}

async function deleteLocalAvatar(imageUrl) {
  const filePath = resolveLocalUploadPath(imageUrl);
  if (filePath) {
    try {
      await fs.promises.unlink(filePath);
      logger.info({ event: "avatar_local_cleanup", filePath }, "Deleted local avatar file");
    } catch (err) {
      logger.warn({ event: "avatar_local_cleanup_failed", filePath, err: err.message }, "Failed to delete local avatar file");
    }
  }
}

async function processAvatar(donorAddress, avatarUrl) {
  const isLocal = typeof avatarUrl === "string" && avatarUrl.startsWith(LOCAL_UPLOAD_PREFIX);
  const ownS3Key = isLocal ? null : resolveOwnS3Key(avatarUrl);
  const eligible = isLocal
    ? resolveLocalUploadPath(avatarUrl) !== null
    : ownS3Key !== null && !isProcessedAvatarKey(ownS3Key);
  if (!eligible) {
    logger.info({ event: "avatar_processing_skipped", donorAddress, avatarUrl }, "Avatar not eligible for processing");
    return { newAvatarUrl: null, skipped: true };
  }

  logger.info({ event: "avatar_processing_start", donorAddress, avatarUrl }, "Starting avatar processing");

  const originalBuffer = await downloadImageFromUrl(avatarUrl);
  const processedBuffer = await processAvatarImage(originalBuffer);
  const key = buildAvatarKey(donorAddress);
  const newAvatarUrl = await uploadAvatarToS3(processedBuffer, key);

  // Guard on the original URL: if the user changed their avatar while this
  // job ran, don't clobber the newer value with this stale result.
  const updated = await pool.query(
    "UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE public_key = $2 AND avatar_url = $3",
    [newAvatarUrl, donorAddress, avatarUrl]
  );

  await deleteLocalAvatar(avatarUrl);

  logger.info(
    {
      event: "avatar_processing_complete",
      donorAddress,
      newAvatarUrl,
      originalBytes: originalBuffer.length,
      processedBytes: processedBuffer.length,
      profileUpdated: updated.rowCount > 0,
    },
    "Avatar processing complete"
  );

  return { newAvatarUrl, skipped: false };
}

async function start(io) {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("[profileQueue] pg-boss error:", err.message));

  await boss.start();

  await boss.work(QUEUE, { teamSize: 2, teamConcurrency: 1 }, async (job) => {
    const { donorAddress } = job.data;
    const result = await processProfileUpdate(donorAddress);

    if (io) {
      io.emit("profile_updated", { donorAddress, ...result });
    }
  });

  await boss.work(AVATAR_QUEUE, { teamSize: 1, teamConcurrency: 1 }, async (job) => {
    const { donorAddress, avatarUrl } = job.data;
    await processAvatar(donorAddress, avatarUrl);
  });

  console.log("[profileQueue] pg-boss started, worker registered on queues:", QUEUE, AVATAR_QUEUE);
}

async function enqueueProfileUpdate(donorAddress) {
  if (!boss) {
    throw new Error("profileQueue not started — call start(io) first");
  }
  return boss.send(QUEUE, { donorAddress }, { retryLimit: 3, retryDelay: 10 });
}

async function enqueueAvatarProcessing(donorAddress, avatarUrl) {
  if (!boss) {
    throw new Error("profileQueue not started — call start(io) first");
  }
  return boss.send(AVATAR_QUEUE, { donorAddress, avatarUrl }, { retryLimit: 3, retryDelay: 10 });
}

module.exports = {
  start,
  enqueueProfileUpdate,
  processProfileUpdate,
  enqueueAvatarProcessing,
  processAvatar,
  processAvatarImage,
  resolveLocalUploadPath,
  resolveOwnS3Key,
  isProcessedAvatarKey,
  MAX_AVATAR_DIMENSION,
};
