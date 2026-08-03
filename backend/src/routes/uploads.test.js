/**
 * src/routes/uploads.test.js — Unit and integration tests for file uploads
 *
 * Tests validate:
 * - Magic bytes validation (reject spoofed Content-Type headers)
 * - MIME type whitelist enforcement
 * - File size limits
 * - Error handling and logging
 * - Legitimate file uploads
 */
"use strict";

const request = require("supertest");
const express = require("express");
const uploadRouter = require("./uploads");
const fs = require("fs");
const path = require("path");

describe("POST /api/uploads — File Upload Security", () => {
  let app;
  let uploadDirBackup;

  beforeAll(() => {
    // Create a minimal Express app with the upload router
    app = express();
    app.use(express.json());
    app.use("/api/uploads", uploadRouter);

    // Store original UPLOAD_DIR for cleanup
    uploadDirBackup = path.join(__dirname, "..", "..", "uploads");
  });

  afterEach(() => {
    // Clean up uploaded files
    if (fs.existsSync(uploadDirBackup)) {
      const files = fs.readdirSync(uploadDirBackup);
      files.forEach((file) => {
        fs.unlinkSync(path.join(uploadDirBackup, file));
      });
    }
  });

  describe("Valid file uploads", () => {
    test("should accept a valid PDF file", async () => {
      // PDF magic bytes: %PDF
      const pdfBuffer = Buffer.from("%PDF-1.4\n%fake pdf content", "utf8");

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", pdfBuffer, "document.pdf");

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBeDefined();
      expect(res.body.data.url).toBeDefined();
      expect(res.body.data.contentType).toBe("application/pdf");
      expect(res.body.data.backend).toBeDefined();
    });

    test("should accept a valid PNG image", async () => {
      // PNG magic bytes: 89 50 4E 47 (hex)
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        // IHDR chunk
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde,
      ]);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", pngBuffer, "image.png");

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contentType).toBe("image/png");
    });

    test("should accept a valid JPEG image", async () => {
      // JPEG magic bytes: FF D8 FF (hex)
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01,
        // ... minimal JPEG structure
      ]);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", jpegBuffer, "photo.jpg");

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contentType).toBe("image/jpeg");
    });

    test("should accept a valid CSV (text/plain)", async () => {
      const csvBuffer = Buffer.from("name,age,email\nJohn,30,john@example.com", "utf8");

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", csvBuffer, "data.csv");

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      // CSV files are detected as text/plain by file-type library
      expect(res.body.data.contentType).toBe("text/plain");
    });

    test("should accept a valid ZIP file", async () => {
      // ZIP magic bytes: 50 4B (PK)
      const zipBuffer = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
        0x08, 0x00,
        // ... minimal ZIP structure
      ]);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", zipBuffer, "archive.zip");

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contentType).toBe("application/zip");
    });
  });

  describe("Spoofed Content-Type attacks", () => {
    test("should reject PHP file disguised as PNG (Content-Type spoofing)", async () => {
      // PHP code with PNG Content-Type header
      const phpBuffer = Buffer.from("<?php system('id'); ?>", "utf8");

      const res = await request(app)
        .post("/api/uploads")
        .set("Content-Type", "multipart/form-data")
        .attach("file", phpBuffer, { filename: "shell.php", contentType: "image/png" });

      expect(res.statusCode).toBe(415);
      expect(res.body.error).toMatch(/Unsupported file type/i);
      expect(res.body.error).not.toMatch(/image\/png/); // Should show detected type, not spoofed type
    });

    test("should reject executable JS file disguised as PDF", async () => {
      // JavaScript code with PDF Content-Type header
      const jsBuffer = Buffer.from(
        "const exec = require('child_process').exec; exec('rm -rf /', (err) => {});",
        "utf8"
      );

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", jsBuffer, { filename: "malware.js", contentType: "application/pdf" });

      expect(res.statusCode).toBe(415);
      expect(res.body.error).toBeDefined();
    });

    test("should reject shell script disguised as image", async () => {
      // Shell script with PNG Content-Type header
      const shBuffer = Buffer.from("#!/bin/bash\nrm -rf /\nexit 0", "utf8");

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", shBuffer, { filename: "malware.sh", contentType: "image/png" });

      expect(res.statusCode).toBe(415);
      expect(res.body.error).toBeDefined();
    });

    test("should reject Windows executable disguised as PDF", async () => {
      // Windows PE executable magic bytes: MZ
      const exeBuffer = Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "utf8");

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", exeBuffer, { filename: "malware.exe", contentType: "application/pdf" });

      expect(res.statusCode).toBe(415);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("Unsupported file types", () => {
    test("should reject file with unrecognized magic bytes", async () => {
      // Random bytes that don't match any known file signature
      const randomBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05], "utf8");

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", randomBuffer, "unknown.bin");

      expect(res.statusCode).toBe(415);
      expect(res.body.error).toMatch(/could not be detected|Unsupported file type/i);
    });

    test("should reject file with empty buffer", async () => {
      const emptyBuffer = Buffer.alloc(0);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", emptyBuffer, "empty.bin");

      expect(res.statusCode).toBe(415);
      expect(res.body.error).toBeDefined();
    });

    test("should reject WebAssembly (.wasm) files", async () => {
      // WASM magic bytes: 00 61 73 6D (0x0 'a' 's' 'm')
      const wasmBuffer = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", wasmBuffer, "module.wasm");

      expect(res.statusCode).toBe(415);
      expect(res.body.error).toMatch(/Unsupported file type/i);
    });
  });

  describe("File size validation", () => {
    test("should reject files exceeding size limit", async () => {
      // Create a buffer exceeding the limit (default 10 MB)
      const oversizeBuffer = Buffer.alloc(11 * 1024 * 1024);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", oversizeBuffer, "huge.pdf");

      expect(res.statusCode).toBe(413);
      expect(res.body.error).toMatch(/File too large/i);
    });
  });

  describe("Missing or invalid file upload", () => {
    test("should reject request with no file", async () => {
      const res = await request(app)
        .post("/api/uploads")
        .field("other_field", "value");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/No file uploaded/i);
    });

    test("should reject request with no multipart body", async () => {
      const res = await request(app)
        .post("/api/uploads")
        .send({});

      expect(res.statusCode).toBe(400);
    });
  });

  describe("Legitimate Office documents", () => {
    test("should accept DOCX (Word) file with correct magic bytes", async () => {
      // DOCX is a ZIP file with specific internal structure
      // Minimal DOCX magic bytes: PK (ZIP signature)
      const docxBuffer = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00,
        0x08, 0x00,
        // ... minimal DOCX structure
      ]);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", docxBuffer, "document.docx");

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test("should accept XLSX (Excel) file with correct magic bytes", async () => {
      // XLSX is also ZIP-based
      const xlsxBuffer = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00,
        0x08, 0x00,
        // ... minimal XLSX structure
      ]);

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", xlsxBuffer, "spreadsheet.xlsx");

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("should handle null or undefined buffer gracefully", async () => {
      // This should be caught by multer before reaching our validation,
      // but test defensive coding.
      const res = await request(app)
        .post("/api/uploads");

      // Should fail because no file is attached
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test("should preserve original filename in response", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\n%content", "utf8");

      const res = await request(app)
        .post("/api/uploads")
        .attach("file", pdfBuffer, "my_document.pdf");

      expect(res.statusCode).toBe(201);
      expect(res.body.data.originalName).toBe("my_document.pdf");
    });
  });
});

describe("GET /api/uploads/:key — Static file serving", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use("/api/uploads", uploadRouter);
  });

  test("should reject path traversal attempts", async () => {
    const res = await request(app).get("/api/uploads/../../../etc/passwd");

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid key/i);
  });

  test("should reject keys with forward slashes", async () => {
    const res = await request(app).get("/api/uploads/dir/file.pdf");

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid key/i);
  });

  test("should return 404 for non-existent files", async () => {
    const res = await request(app).get("/api/uploads/nonexistent-file-key");

    // Should return 404 (or 400 depending on backend configuration)
    expect([400, 404]).toContain(res.statusCode);
  });
});
