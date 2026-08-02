"use strict";

/**
 * Tests for GET /api/uploads/:key — Content-Disposition header (issue #696)
 *
 * We mock the fs, path, and storage modules so no real filesystem access
 * is needed and the tests run deterministically in CI.
 */

jest.mock("../services/storage", () => ({
  uploadFile: jest.fn(),
  backendName: jest.fn(() => "local"),
  UPLOAD_DIR: "/fake/uploads",
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: jest.fn(() => (_req, _res, next) => next()),
}));

// Intercept fs.existsSync so we never touch the real filesystem.
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => true),
}));

const request = require("supertest");
const express = require("express");
const path = require("path");

// path.join and path.sep must behave normally — only UPLOAD_DIR is faked.
// We reload the router after mocks are in place.
const uploadsRouter = require("./uploads");
const { backendName } = require("../services/storage");
const fs = require("fs");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/uploads", uploadsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a realistic storage key the way storage.js does:
 *   crypto.randomBytes(12).toString("hex") + "-" + sanitized-name
 * We use a fixed 24-char hex prefix for predictable assertions.
 */
const HEX_PREFIX = "a1b2c3d4e5f6a1b2c3d4e5f6";
const key = (name) => `${HEX_PREFIX}-${name}`;

// ---------------------------------------------------------------------------
// Content-Disposition — happy path
// ---------------------------------------------------------------------------

describe("GET /api/uploads/:key — Content-Disposition header (issue #696)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    backendName.mockReturnValue("local");
    fs.existsSync.mockReturnValue(true);
  });

  test("sets Content-Disposition: attachment for a PDF key", async () => {
    const res = await request(app).get(`/api/uploads/${key("report_2026.pdf")}`);
    expect(res.headers["content-disposition"]).toMatch(/^attachment/);
  });

  test("includes the original filename in the header", async () => {
    const res = await request(app).get(`/api/uploads/${key("invoice.pdf")}`);
    expect(res.headers["content-disposition"]).toContain("invoice.pdf");
  });

  test("includes both filename= and filename*= params for broad UA support", async () => {
    const res = await request(app).get(`/api/uploads/${key("photo.png")}`);
    const header = res.headers["content-disposition"];
    expect(header).toMatch(/filename="/);
    expect(header).toMatch(/filename\*=UTF-8''/);
  });

  test("strips the hex prefix so the download name is clean", async () => {
    const res = await request(app).get(`/api/uploads/${key("data_export.csv")}`);
    const header = res.headers["content-disposition"];
    // The hex prefix must NOT appear in the filename value.
    expect(header).not.toContain(HEX_PREFIX);
    expect(header).toContain("data_export.csv");
  });

  test("falls back to the raw key as filename when prefix pattern is absent", async () => {
    // A key with no hex prefix (legacy or manually crafted).
    const res = await request(app).get("/api/uploads/myfile.txt");
    const header = res.headers["content-disposition"];
    expect(header).toMatch(/^attachment/);
    expect(header).toContain("myfile.txt");
  });

  test("percent-encodes non-ASCII characters in filename*", async () => {
    // Simulate a sanitized name that still contains non-ASCII bytes.
    const encodedKey = encodeURIComponent(key("repor\u00e9.pdf"));
    const res = await request(app).get(`/api/uploads/${encodedKey}`);
    const header = res.headers["content-disposition"];
    expect(header).toMatch(/filename\*=UTF-8''/);
  });
});

// ---------------------------------------------------------------------------
// Existing behaviour must be preserved
// ---------------------------------------------------------------------------

describe("GET /api/uploads/:key — existing guard behaviour", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    backendName.mockReturnValue("local");
    fs.existsSync.mockReturnValue(true);
  });

  test("returns 404 when the storage backend is not local", async () => {
    backendName.mockReturnValue("s3");
    const res = await request(app).get(`/api/uploads/${key("file.pdf")}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/disabled/i);
  });

  test("returns 400 for a key containing path-traversal sequences", async () => {
    const res = await request(app).get("/api/uploads/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
  });

  test("returns 404 when the file does not exist on disk", async () => {
    fs.existsSync.mockReturnValue(false);
    const res = await request(app).get(`/api/uploads/${key("missing.pdf")}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
