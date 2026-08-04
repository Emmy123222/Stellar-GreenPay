"use strict";

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/storage", () => ({
  uploadFile: jest.fn(async (buf, name, type) => ({
    key: "test-key",
    url: "/api/uploads/test-key",
    size: buf.length,
    contentType: type,
    backend: "local",
  })),
  backendName: () => "local",
  UPLOAD_DIR: "/tmp/uploads",
}));

const express = require("express");
const request = require("supertest");
const uploads = require("./uploads");
const storage = require("../services/storage");

function buildApp() {
  const app = express();
  app.use("/api/uploads", uploads);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("POST /api/uploads — file type validation", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("rejects application/x-executable with 400 including the MIME type", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("ELF binary content"), {
        filename: "program.bin",
        contentType: "application/x-executable",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("application/x-executable");
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test("rejects text/html with 400 including the MIME type", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("<html><body>Hello</body></html>"), {
        filename: "page.html",
        contentType: "text/html",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("text/html");
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test("rejects application/javascript with 400 including the MIME type", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("console.log('hello');"), {
        filename: "script.js",
        contentType: "application/javascript",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("application/javascript");
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test("accepts application/pdf with 201", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("%PDF-1.4 sample content"), {
        filename: "document.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contentType).toBe("application/pdf");

    // Verify the storage service was called with the correct arguments.
    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "document.pdf",
      "application/pdf",
    );
  });
});
