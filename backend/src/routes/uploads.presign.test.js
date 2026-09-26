/**
 * src/routes/uploads.presign.test.js
 *
 * Tests for POST /api/uploads/presign — S3 presigned PUT URL endpoint.
 *
 * All network and AWS SDK calls are mocked so the suite runs without
 * real AWS credentials or S3 connectivity.
 */
"use strict";

// ── Mock the rate limiter so it never actually throttles requests ─────────────
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

// ── Mock the s3Presign service ────────────────────────────────────────────────
jest.mock("../services/s3Presign", () => ({
  generatePresignedPutUrl: jest.fn(),
  isS3Configured: jest.fn(),
  buildKey: jest.fn(),
  ALLOWED_MIME: new Set([
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
  ]),
}));

// ── Mock the storage service (used by the existing POST / route) ──────────────
jest.mock("../services/storage", () => ({
  uploadFile: jest.fn(),
  backendName: jest.fn().mockReturnValue("local"),
  UPLOAD_DIR: "/tmp/uploads",
}));

const request = require("supertest");
const express = require("express");
const uploadsRouter = require("./uploads");
const { generatePresignedPutUrl } = require("../services/s3Presign");

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/uploads", uploadsRouter);
  // Central error handler matching the real app
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const VALID_BODY = {
  originalName: "report.pdf",
  contentType: "application/pdf",
  size: 102400,
};

const MOCK_PRESIGN_RESULT = {
  key: "abc123-report.pdf",
  url: "https://my-bucket.s3.us-east-1.amazonaws.com/abc123-report.pdf?X-Amz-Signature=fake",
  expiry: Math.floor(Date.now() / 1000) + 300,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/uploads/presign — success", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    generatePresignedPutUrl.mockResolvedValue(MOCK_PRESIGN_RESULT);
  });

  test("returns 200 with key, url, and expiry when S3 is configured", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send(VALID_BODY)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      key: MOCK_PRESIGN_RESULT.key,
      url: MOCK_PRESIGN_RESULT.url,
      expiry: MOCK_PRESIGN_RESULT.expiry,
    });
  });

  test("calls generatePresignedPutUrl with the trimmed originalName and contentType", async () => {
    await request(app)
      .post("/api/uploads/presign")
      .send({
        originalName: "  my-doc.pdf  ",
        contentType: "  application/pdf  ",
        size: 1024,
      })
      .expect(200);

    expect(generatePresignedPutUrl).toHaveBeenCalledWith({
      originalName: "my-doc.pdf",
      contentType: "application/pdf",
      size: 1024,
    });
  });

  test("accepts a request without size (size is optional)", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send({ originalName: "photo.png", contentType: "image/png" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(generatePresignedPutUrl).toHaveBeenCalledWith({
      originalName: "photo.png",
      contentType: "image/png",
      size: undefined,
    });
  });

  test("response data contains a url that is a non-empty string", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send(VALID_BODY)
      .expect(200);

    expect(typeof res.body.data.url).toBe("string");
    expect(res.body.data.url.length).toBeGreaterThan(0);
  });

  test("response data expiry is a positive integer (Unix timestamp)", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send(VALID_BODY)
      .expect(200);

    expect(Number.isInteger(res.body.data.expiry)).toBe(true);
    expect(res.body.data.expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("accepts all whitelisted MIME types without error", async () => {
    const mimeTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "text/plain",
      "text/csv",
      "application/zip",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    for (const contentType of mimeTypes) {
      generatePresignedPutUrl.mockResolvedValue(MOCK_PRESIGN_RESULT);
      const res = await request(app)
        .post("/api/uploads/presign")
        .send({ originalName: "file.bin", contentType })
        .expect(200);

      expect(res.body.success).toBe(true);
    }
  });
});

describe("POST /api/uploads/presign — input validation", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns 400 when originalName is missing", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send({ contentType: "application/pdf" })
      .expect(400);

    expect(res.body.error).toMatch(/originalName/i);
    expect(generatePresignedPutUrl).not.toHaveBeenCalled();
  });

  test("returns 400 when originalName is an empty string", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send({ originalName: "   ", contentType: "application/pdf" })
      .expect(400);

    expect(res.body.error).toMatch(/originalName/i);
  });

  test("returns 400 when contentType is missing", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send({ originalName: "doc.pdf" })
      .expect(400);

    expect(res.body.error).toMatch(/contentType/i);
    expect(generatePresignedPutUrl).not.toHaveBeenCalled();
  });

  test("returns 400 when originalName is not a string", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send({ originalName: 42, contentType: "application/pdf" })
      .expect(400);

    expect(res.body.error).toMatch(/originalName/i);
  });

  test("returns 400 when body is empty / missing", async () => {
    const res = await request(app)
      .post("/api/uploads/presign")
      .send({})
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(generatePresignedPutUrl).not.toHaveBeenCalled();
  });

  test("returns 400 when the service rejects the content type as unsupported", async () => {
    const err = new Error("Unsupported content type: application/x-bad");
    err.statusCode = 400;
    generatePresignedPutUrl.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/uploads/presign")
      .send({ originalName: "bad.exe", contentType: "application/x-bad" })
      .expect(400);

    expect(res.body.error).toMatch(/unsupported content type/i);
  });

  test("returns 413 when the service reports the file is too large", async () => {
    const err = new Error("File too large. Maximum size is 10 MB.");
    err.statusCode = 413;
    generatePresignedPutUrl.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/uploads/presign")
      .send({ originalName: "big.pdf", contentType: "application/pdf", size: 999999999 })
      .expect(413);

    expect(res.body.error).toMatch(/too large/i);
  });
});

describe("POST /api/uploads/presign — S3 not configured (fallback)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns 503 when S3 credentials are not set", async () => {
    const err = new Error(
      "Presigned uploads require STORAGE_BACKEND=s3. Use POST /api/uploads for a standard upload."
    );
    err.statusCode = 503;
    generatePresignedPutUrl.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/uploads/presign")
      .send(VALID_BODY)
      .expect(503);

    expect(res.body.error).toMatch(/presigned uploads require/i);
  });

  test("503 response includes a fallback hint pointing to POST /api/uploads", async () => {
    const err = new Error(
      "Presigned uploads require STORAGE_BACKEND=s3. Use POST /api/uploads for a standard upload."
    );
    err.statusCode = 503;
    generatePresignedPutUrl.mockRejectedValue(err);

    const res = await request(app)
      .post("/api/uploads/presign")
      .send(VALID_BODY)
      .expect(503);

    expect(res.body.fallback).toMatch(/POST \/api\/uploads/i);
  });
});

describe("POST /api/uploads/presign — unexpected errors", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("propagates unexpected errors to the central error handler as 500", async () => {
    generatePresignedPutUrl.mockRejectedValue(new Error("SDK blew up unexpectedly"));

    const res = await request(app)
      .post("/api/uploads/presign")
      .send(VALID_BODY)
      .expect(500);

    expect(res.body.error).toBeDefined();
  });
});

// Note: s3Presign service unit tests live in
// src/services/s3Presign.test.js to allow clean module isolation
// with jest.resetModules() and jest.mock() without conflicting with
// the top-level mocks in this file.
