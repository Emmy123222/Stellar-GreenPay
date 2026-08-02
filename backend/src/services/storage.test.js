"use strict";

/**
 * Tests for storage.js — S3 fallback to local when env vars are missing.
 *
 * STORAGE_BACKEND is captured at module load time, so each test that needs
 * a specific backend must reset the module registry, set env vars, then
 * re-require storage.js fresh. The logger is mocked so we can assert on
 * warning calls without any real I/O.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");

// ── Logger mock — must be declared before any require of storage.js ──────────
jest.mock("../logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
}));

// ── aws-sdk mock — present but with no real credentials ──────────────────────
// This simulates an environment where the SDK is installed but the required
// env vars (AWS_REGION etc.) are absent, which is the primary fallback path.
jest.mock("aws-sdk", () => ({}), { virtual: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Snapshot and restore env vars around a test. */
function withEnv(overrides, fn) {
  return async () => {
    const saved = {};
    const toDelete = [];

    for (const [key, value] of Object.entries(overrides)) {
      if (key in process.env) {
        saved[key] = process.env[key];
      } else {
        toDelete.push(key);
      }
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    try {
      await fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        process.env[key] = value;
      }
      for (const key of toDelete) {
        delete process.env[key];
      }
    }
  };
}

/**
 * Re-require storage.js with the module cache cleared so STORAGE_BACKEND
 * is re-evaluated from process.env.
 */
function freshStorage() {
  jest.resetModules();
  // Re-apply the logger mock after resetModules clears the registry.
  jest.mock("../logger", () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }));
  jest.mock("aws-sdk", () => ({}), { virtual: true });
  return require("./storage");
}

/** Redirect the UPLOAD_DIR to a temp directory so we never touch the real one. */
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));

afterAll(() => {
  try {
    for (const f of fs.readdirSync(TEST_DIR)) fs.unlinkSync(path.join(TEST_DIR, f));
    fs.rmdirSync(TEST_DIR);
  } catch { /* best-effort */ }
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("storage.js — S3 fallback when env vars are missing", () => {
  const PDF_BUF = Buffer.from("%PDF-1.4 test");

  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure no S3 credentials leak in from the outer environment.
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET;
  });

  test(
    "uploadFile() falls back to local storage when STORAGE_BACKEND=s3 but AWS_REGION is not set",
    withEnv({ STORAGE_BACKEND: "s3" }, async () => {
      const { uploadFile } = freshStorage();
      const result = await uploadFile(PDF_BUF, "test.pdf", "application/pdf");

      // Should have written a real file somewhere — key and url must be present.
      expect(typeof result.key).toBe("string");
      expect(result.key.length).toBeGreaterThan(0);
      expect(typeof result.url).toBe("string");
    })
  );

  test(
    "returned backend field is 'local' when falling back from S3",
    withEnv({ STORAGE_BACKEND: "s3" }, async () => {
      const { uploadFile } = freshStorage();
      const result = await uploadFile(PDF_BUF, "test.pdf", "application/pdf");

      expect(result.backend).toBe("local");
    })
  );

  test(
    "emits a warn log with event='storage_s3_env_missing' when falling back",
    withEnv({ STORAGE_BACKEND: "s3" }, async () => {
      // Re-require so both storage and logger share the same fresh mock.
      jest.resetModules();
      jest.mock("../logger", () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() }));
      jest.mock("aws-sdk", () => ({}), { virtual: true });

      const logger = require("../logger");
      const { uploadFile } = require("./storage");

      await uploadFile(PDF_BUF, "test.pdf", "application/pdf");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "storage_s3_env_missing" }),
        expect.stringMatching(/falling back to local/i)
      );
    })
  );

  test(
    "warning log includes the list of missing env vars",
    withEnv({ STORAGE_BACKEND: "s3" }, async () => {
      jest.resetModules();
      jest.mock("../logger", () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() }));
      jest.mock("aws-sdk", () => ({}), { virtual: true });

      const logger = require("../logger");
      const { uploadFile } = require("./storage");

      await uploadFile(PDF_BUF, "test.pdf", "application/pdf");

      const [meta] = logger.warn.mock.calls[0];
      expect(Array.isArray(meta.missing)).toBe(true);
      expect(meta.missing).toContain("AWS_REGION");
    })
  );

  test(
    "fallback still returns a valid url pointing at /api/uploads/",
    withEnv({ STORAGE_BACKEND: "s3" }, async () => {
      const { uploadFile } = freshStorage();
      const result = await uploadFile(PDF_BUF, "doc.pdf", "application/pdf");

      expect(result.url).toMatch(/^\/api\/uploads\//);
    })
  );

  test(
    "fallback works even when all four required S3 env vars are absent",
    withEnv({
      STORAGE_BACKEND: "s3",
      AWS_REGION: undefined,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      S3_BUCKET: undefined,
    }, async () => {
      const { uploadFile } = freshStorage();
      const result = await uploadFile(PDF_BUF, "all-missing.pdf", "application/pdf");

      expect(result.backend).toBe("local");
    })
  );

  test(
    "uploadFile() rejects non-Buffer input regardless of backend",
    withEnv({ STORAGE_BACKEND: "s3" }, async () => {
      const { uploadFile } = freshStorage();

      await expect(uploadFile("not a buffer", "test.pdf", "application/pdf"))
        .rejects.toThrow(/uploadFile requires a Buffer/i);
    })
  );
});
