/**
 * src/services/s3Presign.test.js
 *
 * Unit tests for the s3Presign service module.
 * The AWS SDK is mocked at the top level so no real S3 calls are made.
 */
"use strict";

// ── Top-level mocks (hoisted by Jest) ────────────────────────────────────────

let mockGetSignedUrl;

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ _params: params })),
}));

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  // We proxy through a stable reference so individual tests can control
  // what getSignedUrl resolves to.
  getSignedUrl: jest.fn((...args) => mockGetSignedUrl(...args)),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

const { generatePresignedPutUrl, isS3Configured, buildKey } = require("./s3Presign");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_URL = "https://bucket.s3.us-east-1.amazonaws.com/key?X-Amz-Signature=fake";

function setS3Env() {
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  process.env.S3_BUCKET = "test-bucket";
}

function clearS3Env() {
  delete process.env.AWS_REGION;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.S3_BUCKET;
}

// Save and restore S3 env vars so tests don't pollute each other.
const SAVED = {};
beforeAll(() => {
  ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET",
    "UPLOAD_MAX_BYTES", "PRESIGN_EXPIRY_SECONDS"].forEach((k) => {
    SAVED[k] = process.env[k];
  });
});

afterAll(() => {
  Object.entries(SAVED).forEach(([k, v]) => {
    if (v !== undefined) process.env[k] = v;
    else delete process.env[k];
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  clearS3Env();
  delete process.env.UPLOAD_MAX_BYTES;
  delete process.env.PRESIGN_EXPIRY_SECONDS;
  // Default: SDK returns a fake signed URL
  mockGetSignedUrl = jest.fn().mockResolvedValue(FAKE_URL);
});

// ── isS3Configured ───────────────────────────────────────────────────────────

describe("isS3Configured", () => {
  test("returns false when no S3 env vars are set", () => {
    expect(isS3Configured()).toBe(false);
  });

  test("returns false when only some S3 env vars are present", () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    // SECRET and BUCKET missing
    expect(isS3Configured()).toBe(false);
  });

  test("returns true when all four required S3 env vars are set", () => {
    setS3Env();
    expect(isS3Configured()).toBe(true);
  });
});

// ── buildKey ─────────────────────────────────────────────────────────────────

describe("buildKey", () => {
  test("returns a string", () => {
    expect(typeof buildKey("report.pdf")).toBe("string");
  });

  test("sanitises path traversal characters — no forward slashes in output", () => {
    const key = buildKey("../../../etc/passwd");
    // Slashes are replaced with underscores; dots are kept (they are valid in S3 keys)
    // but no slash means no directory traversal in the object key.
    expect(key).not.toMatch(/\//);
  });

  test("sanitises spaces and special characters in the filename", () => {
    const key = buildKey("my file (1).pdf");
    expect(key).not.toMatch(/[ ()]/);
  });

  test("key begins with a 24-char hex prefix followed by a dash", () => {
    const key = buildKey("doc.pdf");
    expect(key).toMatch(/^[0-9a-f]{24}-/);
  });

  test("key ends with the sanitised filename portion", () => {
    const key = buildKey("doc.pdf");
    expect(key).toMatch(/doc\.pdf$/);
  });

  test("caps the total key length (24 hex + 1 dash + max 80 chars for name)", () => {
    const longName = "a".repeat(200) + ".pdf";
    const key = buildKey(longName);
    expect(key.length).toBeLessThanOrEqual(24 + 1 + 80);
  });

  test("handles undefined originalName without throwing", () => {
    expect(() => buildKey(undefined)).not.toThrow();
  });

  test("handles null originalName without throwing", () => {
    expect(() => buildKey(null)).not.toThrow();
  });

  test("two calls produce different keys (random prefix)", () => {
    const k1 = buildKey("file.pdf");
    const k2 = buildKey("file.pdf");
    expect(k1).not.toBe(k2);
  });
});

// ── generatePresignedPutUrl — validation ─────────────────────────────────────

describe("generatePresignedPutUrl — input validation", () => {
  test("throws statusCode 400 for an unsupported content type", async () => {
    await expect(
      generatePresignedPutUrl({ originalName: "bad.exe", contentType: "application/x-msdownload" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("throws statusCode 400 when contentType is an empty string", async () => {
    await expect(
      generatePresignedPutUrl({ originalName: "doc.pdf", contentType: "" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("throws statusCode 400 when contentType is null", async () => {
    await expect(
      generatePresignedPutUrl({ originalName: "doc.pdf", contentType: null })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("throws statusCode 413 when size exceeds UPLOAD_MAX_BYTES", async () => {
    process.env.UPLOAD_MAX_BYTES = "1024";
    await expect(
      generatePresignedPutUrl({ originalName: "big.pdf", contentType: "application/pdf", size: 2048 })
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  test("does not throw 413 when size equals UPLOAD_MAX_BYTES exactly", async () => {
    setS3Env();
    process.env.UPLOAD_MAX_BYTES = "1024";
    const result = await generatePresignedPutUrl({
      originalName: "exact.pdf",
      contentType: "application/pdf",
      size: 1024,
    });
    expect(result).toHaveProperty("key");
  });

  test("throws statusCode 400 when size is a negative number", async () => {
    await expect(
      generatePresignedPutUrl({ originalName: "doc.pdf", contentType: "application/pdf", size: -1 })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("throws statusCode 400 when size is non-finite (NaN)", async () => {
    await expect(
      generatePresignedPutUrl({ originalName: "doc.pdf", contentType: "application/pdf", size: NaN })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("skips size validation when size is not provided", async () => {
    setS3Env();
    const result = await generatePresignedPutUrl({
      originalName: "photo.png",
      contentType: "image/png",
    });
    expect(result).toHaveProperty("url");
  });

  test("skips size validation when size is undefined", async () => {
    setS3Env();
    const result = await generatePresignedPutUrl({
      originalName: "photo.png",
      contentType: "image/png",
      size: undefined,
    });
    expect(result).toHaveProperty("url");
  });
});

// ── generatePresignedPutUrl — S3 not configured ──────────────────────────────

describe("generatePresignedPutUrl — S3 not configured", () => {
  test("throws statusCode 503 when S3 env vars are absent", async () => {
    // S3 env vars cleared in beforeEach
    await expect(
      generatePresignedPutUrl({ originalName: "doc.pdf", contentType: "application/pdf" })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  test("503 error message tells the caller to use STORAGE_BACKEND=s3", async () => {
    let caught;
    try {
      await generatePresignedPutUrl({ originalName: "doc.pdf", contentType: "application/pdf" });
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toMatch(/STORAGE_BACKEND=s3/i);
  });

  test("does not call getSignedUrl when S3 is not configured", async () => {
    try {
      await generatePresignedPutUrl({ originalName: "doc.pdf", contentType: "application/pdf" });
    } catch (_) {
      // expected
    }
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

// ── generatePresignedPutUrl — happy path ─────────────────────────────────────

describe("generatePresignedPutUrl — happy path", () => {
  beforeEach(() => {
    setS3Env();
  });

  test("returns an object with key, url, and expiry", async () => {
    const result = await generatePresignedPutUrl({
      originalName: "report.pdf",
      contentType: "application/pdf",
    });

    expect(result).toHaveProperty("key");
    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("expiry");
  });

  test("url matches the value returned by getSignedUrl", async () => {
    const result = await generatePresignedPutUrl({
      originalName: "report.pdf",
      contentType: "application/pdf",
    });
    expect(result.url).toBe(FAKE_URL);
  });

  test("key is a non-empty string starting with a 24-char hex prefix", async () => {
    const result = await generatePresignedPutUrl({
      originalName: "doc.pdf",
      contentType: "application/pdf",
    });
    expect(typeof result.key).toBe("string");
    expect(result.key).toMatch(/^[0-9a-f]{24}-/);
  });

  test("expiry is a Unix timestamp roughly (default 300 s) in the future", async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await generatePresignedPutUrl({
      originalName: "report.pdf",
      contentType: "application/pdf",
    });
    expect(result.expiry).toBeGreaterThanOrEqual(before + 299);
    expect(result.expiry).toBeLessThanOrEqual(before + 301);
  });

  test("expiry respects PRESIGN_EXPIRY_SECONDS env var", async () => {
    process.env.PRESIGN_EXPIRY_SECONDS = "60";
    const before = Math.floor(Date.now() / 1000);
    const result = await generatePresignedPutUrl({
      originalName: "photo.png",
      contentType: "image/png",
    });
    expect(result.expiry).toBeGreaterThanOrEqual(before + 59);
    expect(result.expiry).toBeLessThanOrEqual(before + 61);
  });

  test("calls PutObjectCommand with the correct Bucket and ContentType", async () => {
    await generatePresignedPutUrl({
      originalName: "doc.pdf",
      contentType: "application/pdf",
    });

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "test-bucket",
        ContentType: "application/pdf",
      })
    );
  });

  test("calls S3Client constructor with the configured region and credentials", async () => {
    await generatePresignedPutUrl({
      originalName: "doc.pdf",
      contentType: "application/pdf",
    });

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "us-east-1",
        credentials: expect.objectContaining({
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        }),
      })
    );
  });

  test("wraps SDK errors as statusCode 500", async () => {
    mockGetSignedUrl = jest.fn().mockRejectedValue(new Error("AWS SDK exploded"));

    await expect(
      generatePresignedPutUrl({
        originalName: "doc.pdf",
        contentType: "application/pdf",
      })
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
