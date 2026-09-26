"use strict";
/**
 * tests for issue #1101 wiring in src/routes/uploads.js
 *
 * POST /api/uploads must scan S3-hosted images with the moderation service
 * right after the bytes are stored, and must never hand back a usable URL for
 * a rejected image:
 *   - rejected            → 422 { error, code: "image_rejected" } + object deleted
 *   - scanner unavailable → 503 (fail-closed), object left for a retry
 *   - pending_review      → 201 + data.moderation.flaggedForReview
 *   - skipped/not run     → 201, exactly the pre-#1101 payload
 *   - non-images / local backend → moderation is not invoked at all
 */

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/storage", () => {
  const uploads = [];
  return {
    uploads,
    UPLOAD_DIR: "/tmp/unused",
    backendName: () => "s3",
    uploadFile: jest.fn(async (buffer, originalName, contentType) => {
      const key = `abc123-${originalName}`;
      uploads.push(key);
      return {
        key,
        url: `https://greenpay-uploads.s3.us-east-1.amazonaws.com/${key}`,
        size: buffer.length,
        contentType,
        backend: "s3",
      };
    }),
  };
});

jest.mock("../services/moderation", () => ({
  STATUS: { APPROVED: "approved", REJECTED: "rejected", PENDING_REVIEW: "pending_review" },
  OUTCOME: {
    APPROVED: "approved",
    REJECTED: "rejected",
    PENDING_REVIEW: "pending_review",
    SKIPPED: "skipped",
    UNAVAILABLE: "unavailable",
  },
  moderateImage: jest.fn(),
  recordModerationDecision: jest.fn().mockResolvedValue("dec-1"),
  deleteRejectedObject: jest.fn().mockResolvedValue(true),
  moderationSummary: jest.fn((verdict) =>
    verdict && verdict.applied
      ? {
        status: verdict.status,
        flaggedForReview: !!verdict.flaggedForReview,
        maxConfidence: verdict.maxConfidence,
        provider: verdict.provider,
        reason: verdict.reason,
      }
      : undefined,
  ),
}));

const storage = require("../services/storage");
const moderation = require("../services/moderation");
const express = require("express");
const request = require("supertest");
const uploadsRouter = require("./uploads");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/uploads", uploadsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

/** PNG magic bytes — file-type must detect image/png from the content. */
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" + "890000000a49444154789c6300010000050001" + "0d0a2db40000000049454e44ae426082",
  "hex",
);

const PDF_BYTES = Buffer.from("%PDF-1.4 a document");

function uploadImage(app = buildApp(), filename = "photo.png", bytes = PNG_BYTES) {
  return request(app).post("/api/uploads").attach("file", bytes, {
    filename,
    contentType: "image/png",
  });
}

function verdict(overrides) {
  return {
    applied: true,
    blocked: false,
    status: moderation.STATUS.APPROVED,
    reason: null,
    maxConfidence: 2,
    labels: [],
    flaggedForReview: false,
    newDecision: true,
    decisionId: null,
    provider: "aws_rekognition",
    imageUrl: "https://greenpay-uploads.s3.us-east-1.amazonaws.com/abc123-photo.png",
    storageKey: "abc123-photo.png",
    bucket: "greenpay-uploads",
    ...overrides,
  };
}

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = buildApp();
  moderation.moderateImage.mockResolvedValue(verdict({}));
  moderation.recordModerationDecision.mockResolvedValue("dec-1");
  moderation.deleteRejectedObject.mockResolvedValue(true);
});

describe("POST /api/uploads — image moderation (issue #1101)", () => {
  test("scans the stored image from the in-memory buffer", async () => {
    const res = await uploadImage();
    expect(res.status).toBe(201);

    expect(moderation.moderateImage).toHaveBeenCalledTimes(1);
    const call = moderation.moderateImage.mock.calls[0][0];
    expect(Buffer.isBuffer(call.bytes)).toBe(true);
    expect(call.key).toBe("abc123-photo.png");
    expect(call.storageBackend).toBe("s3");
    expect(call.imageUrl).toMatch(/^https:\/\/greenpay-uploads\.s3\./);
  });

  test("logs every verdict in update_images before responding", async () => {
    await uploadImage();
    expect(moderation.recordModerationDecision).toHaveBeenCalledTimes(1);
    const logged = moderation.recordModerationDecision.mock.calls[0][0];
    expect(logged.status).toBe("approved");
    expect(logged.storageKey).toBe("abc123-photo.png");
    // No update exists yet at upload time — the route links it later.
    expect(logged.updateId).toBeUndefined();
  });

  test("a clean upload keeps the original 201 payload shape", async () => {
    const res = await uploadImage();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toBe("abc123-photo.png");
    expect(res.body.data.originalName).toBe("photo.png");
    expect(res.body.data.moderation).toEqual({
      status: "approved",
      flaggedForReview: false,
      maxConfidence: 2,
      provider: "aws_rekognition",
      reason: null,
    });
  });

  test("rejects an NSFW image with 422 and deletes the stored object", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({
        status: moderation.STATUS.REJECTED,
        blocked: true,
        maxConfidence: 88,
        reason: "Image auto-rejected: \"Graphic Nudity\" at 88% confidence exceeds the 70% limit.",
        labels: [{ name: "Graphic Nudity", family: "Explicit Nudity", confidence: 88, categories: [] }],
      }),
    );

    const res = await uploadImage();

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("image_rejected");
    expect(res.body.error).toMatch(/auto-rejected/i);
    expect(res.body.data).toBeUndefined();
    expect(moderation.recordModerationDecision).toHaveBeenCalledTimes(1);
    expect(moderation.deleteRejectedObject).toHaveBeenCalledWith({
      bucket: "greenpay-uploads",
      key: "abc123-photo.png",
    });
  });

  test("fails closed with 503 when the scanner is unreachable", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({
        status: moderation.OUTCOME.UNAVAILABLE,
        blocked: true,
        newDecision: false,
        maxConfidence: null,
        reason: "Image could not be scanned (Rekognition timed out).",
      }),
    );

    const res = await uploadImage();

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("image_moderation_unavailable");
    // The object is kept: the content is unknown, not objectionable.
    expect(moderation.deleteRejectedObject).not.toHaveBeenCalled();
    expect(moderation.recordModerationDecision).not.toHaveBeenCalled();
  });

  test("publishes a flagged image with the review marker", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({
        status: moderation.STATUS.PENDING_REVIEW,
        flaggedForReview: true,
        maxConfidence: 64,
        reason: "Flagged for manual review",
      }),
    );

    const res = await uploadImage();

    expect(res.status).toBe(201);
    expect(res.body.data.moderation).toMatchObject({
      status: "pending_review",
      flaggedForReview: true,
    });
    expect(moderation.deleteRejectedObject).not.toHaveBeenCalled();
  });

  test("a skipped verdict (moderation not configured) leaves uploads untouched", async () => {
    moderation.moderateImage.mockResolvedValue({
      applied: false,
      blocked: false,
      status: moderation.OUTCOME.SKIPPED,
      skipReason: "not_configured",
      reason: null,
      maxConfidence: null,
      labels: [],
      flaggedForReview: false,
      newDecision: false,
      decisionId: null,
      provider: null,
    });

    const res = await uploadImage();
    expect(res.status).toBe(201);
    expect(res.body.data.moderation).toBeUndefined();
    expect(moderation.recordModerationDecision).not.toHaveBeenCalled();
  });

  test("does not moderate documents", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", PDF_BYTES, { filename: "report.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(moderation.moderateImage).not.toHaveBeenCalled();
  });

  test("does not moderate files stored outside S3", async () => {
    storage.uploadFile.mockImplementationOnce(
      async () => ({
        key: "abc123-photo.png",
        url: "/api/uploads/abc123-photo.png",
        size: PNG_BYTES.length,
        contentType: "image/png",
        backend: "local",
      }),
    );

    const res = await uploadImage();
    expect(res.status).toBe(201);
    expect(moderation.moderateImage).not.toHaveBeenCalled();
    expect(res.body.data.moderation).toBeUndefined();
  });

  test("type validation still runs before moderation", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("MZ\u0090\u0000"), {
        filename: "virus.exe",
        contentType: "image/png",
      });

    expect(res.status).toBe(415);
    expect(moderation.moderateImage).not.toHaveBeenCalled();
  });

  test("a moderation service that unexpectedly throws is handled by the error middleware", async () => {
    moderation.moderateImage.mockRejectedValue(new Error("boom"));
    app = express();
    app.use(express.json());
    app.use("/api/uploads", uploadsRouter);
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

    const res = await uploadImage(app);
    expect(res.status).toBe(500);
  });
});
