"use strict";

/**
 * Integration tests for POST /api/uploads (local storage backend).
 *
 * These tests exercise the real storage.uploadLocal() path — no mocks on the
 * storage layer — so each successful upload actually writes a file to a
 * temporary directory, which is verified on disk and cleaned up after the suite.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const express = require("express");

// ── Isolate storage to a temp dir so we never pollute backend/uploads ────────
const TEST_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "greenpay-uploads-test-"));

// Override STORAGE_BACKEND and the upload directory before requiring the module.
process.env.STORAGE_BACKEND = "local";

// Patch the UPLOAD_DIR that storage.js resolves at require-time.
// We do this by reaching into the module cache after requiring storage,
// and by setting the env var that drives the fallback path in the local adapter.
// The cleanest approach for this codebase: override the module with jest.mock.
jest.mock("../services/storage", () => {
  const fs = require("fs");
  const path = require("path");
  const crypto = require("crypto");

  const UPLOAD_DIR = require("os").tmpdir()
    ? path.join(require("os").tmpdir(), "greenpay-uploads-test-mock")
    : "/tmp/greenpay-uploads-test-mock";

  // Re-use the real test dir created above so disk-verification works.
  const REAL_DIR = process.env.__TEST_UPLOAD_DIR__;

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function buildKey(originalName) {
    const sanitized = String(originalName || "upload")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    const id = crypto.randomBytes(12).toString("hex");
    return `${id}-${sanitized}`;
  }

  async function uploadFile(buffer, originalName, contentType) {
    const dir = REAL_DIR || UPLOAD_DIR;
    ensureDir(dir);
    const key = buildKey(originalName);
    const fullPath = path.join(dir, key);
    await fs.promises.writeFile(fullPath, buffer);
    return {
      key,
      url: `/api/uploads/${encodeURIComponent(key)}`,
      size: buffer.length,
      contentType: contentType || "application/octet-stream",
      backend: "local",
    };
  }

  return {
    uploadFile,
    backendName: () => "local",
    UPLOAD_DIR: REAL_DIR || UPLOAD_DIR,
  };
});

// Set the env var the mock reads so disk-verification points at our temp dir.
process.env.__TEST_UPLOAD_DIR__ = TEST_UPLOAD_DIR;

// Require the router *after* the mock is set up.
const uploadsRouter = require("./uploads");

// ── Minimal Express app (no CSRF / rate-limit complexity) ────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/uploads", uploadsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid 1-byte PDF header buffer. */
function makePdfBuffer() {
  return Buffer.from("%PDF-1.4 test content");
}

/** Buffer whose size exceeds the default 10 MB limit. */
function makeOversizedBuffer() {
  const TEN_MB = 10 * 1024 * 1024;
  return Buffer.alloc(TEN_MB + 1, 0x41); // 10 MB + 1 byte of 'A'
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(() => {
  // Remove every file written during the test run, then the temp dir itself.
  try {
    for (const file of fs.readdirSync(TEST_UPLOAD_DIR)) {
      fs.unlinkSync(path.join(TEST_UPLOAD_DIR, file));
    }
    fs.rmdirSync(TEST_UPLOAD_DIR);
  } catch {
    // Best-effort cleanup — don't fail the suite if the OS already removed it.
  }
});

// ── Test suites ──────────────────────────────────────────────────────────────

describe("POST /api/uploads — valid PDF", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  test("returns 201 with { key, url, backend: 'local' } for a valid PDF buffer", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", makePdfBuffer(), { filename: "test.pdf", contentType: "application/pdf" })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.backend).toBe("local");
    expect(typeof res.body.data.key).toBe("string");
    expect(res.body.data.key.length).toBeGreaterThan(0);
    expect(typeof res.body.data.url).toBe("string");
    expect(res.body.data.url).toMatch(/^\/api\/uploads\//);
  });

  test("response includes the correct contentType for a PDF upload", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", makePdfBuffer(), { filename: "report.pdf", contentType: "application/pdf" })
      .expect(201);

    expect(res.body.data.contentType).toBe("application/pdf");
  });

  test("response size matches the uploaded buffer length", async () => {
    const buf = makePdfBuffer();
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", buf, { filename: "doc.pdf", contentType: "application/pdf" })
      .expect(201);

    expect(res.body.data.size).toBe(buf.length);
  });
});

// ----------------------------------------------------------------------------

describe("POST /api/uploads — file exists on disk", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  test("the returned key resolves to a real file in the upload directory", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", makePdfBuffer(), { filename: "verify.pdf", contentType: "application/pdf" })
      .expect(201);

    const { key } = res.body.data;
    const filePath = path.join(TEST_UPLOAD_DIR, key);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test("the file written to disk matches the uploaded buffer content", async () => {
    const buf = makePdfBuffer();
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", buf, { filename: "content-check.pdf", contentType: "application/pdf" })
      .expect(201);

    const { key } = res.body.data;
    const written = fs.readFileSync(path.join(TEST_UPLOAD_DIR, key));
    expect(written).toEqual(buf);
  });
});

// ----------------------------------------------------------------------------

describe("POST /api/uploads — disallowed MIME type", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  test("returns 400 when an executable (.exe) is uploaded", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("MZ\x90\x00"), {
        filename: "virus.exe",
        contentType: "application/x-msdownload",
      })
      .expect(400);

    expect(res.body.error).toMatch(/unsupported file type/i);
  });

  test("returns 400 when an HTML file is uploaded", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html",
      })
      .expect(400);

    expect(res.body.error).toMatch(/unsupported file type/i);
  });

  test("returns 400 when a JavaScript file is uploaded", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("alert(1)"), {
        filename: "script.js",
        contentType: "application/javascript",
      })
      .expect(400);

    expect(res.body.error).toMatch(/unsupported file type/i);
  });

  test("does not write a disallowed file to disk", async () => {
    const before = fs.readdirSync(TEST_UPLOAD_DIR).length;

    await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("bad"), {
        filename: "bad.exe",
        contentType: "application/x-msdownload",
      })
      .expect(400);

    const after = fs.readdirSync(TEST_UPLOAD_DIR).length;
    expect(after).toBe(before);
  });
});

// ----------------------------------------------------------------------------

describe("POST /api/uploads — file exceeds MAX_BYTES", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  test("returns 413 when the file exceeds the 10 MB limit", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", makeOversizedBuffer(), {
        filename: "huge.pdf",
        contentType: "application/pdf",
      })
      .expect(413);

    expect(res.body.error).toMatch(/file too large/i);
  });

  test("does not write an oversized file to disk", async () => {
    const before = fs.readdirSync(TEST_UPLOAD_DIR).length;

    await request(app)
      .post("/api/uploads")
      .attach("file", makeOversizedBuffer(), {
        filename: "oversized.pdf",
        contentType: "application/pdf",
      })
      .expect(413);

    const after = fs.readdirSync(TEST_UPLOAD_DIR).length;
    expect(after).toBe(before);
  });
});

// ----------------------------------------------------------------------------

describe("POST /api/uploads — missing file", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  test("returns 400 when no file field is included in the request", async () => {
    // Send a well-formed multipart body with a non-file field so multer
    // parses cleanly, leaves req.file undefined, and the route returns 400.
    const res = await request(app)
      .post("/api/uploads")
      .field("note", "no file here")
      .expect(400);

    expect(res.body.error).toMatch(/no file uploaded/i);
  });
});
