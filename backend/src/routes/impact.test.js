"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const cache = require("../services/cache");
const impactRouter = require("./impact");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/impact", impactRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("HTTP Conditional Caching for /api/impact", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    cache.clear();
    jest.clearAllMocks();
  });

  describe("GET /api/impact/global", () => {
    const mockTotals = {
      rows: [
        {
          totalDonationsXLM: "5000.0000000",
          donorCount: 10,
          co2OffsetKg: "1000",
        },
      ],
    };
    const mockBreakdown = {
      rows: [
        {
          category: "Reforestation",
          totalDonationsXLM: "5000.0000000",
          donorCount: 10,
          co2OffsetKg: "1000",
        },
      ],
    };
    const mockTimestamps = {
      rows: [
        {
          maxProjectUpdated: "2026-06-01T12:00:00.000Z",
          maxDonationCreated: "2026-06-02T12:00:00.000Z",
        },
      ],
    };

    function setupGlobalMocks(timestamps = mockTimestamps) {
      pool.query
        .mockResolvedValueOnce(mockTotals)
        .mockResolvedValueOnce(mockBreakdown)
        .mockResolvedValueOnce(timestamps);
    }

    test("returns 200 OK with ETag and Last-Modified headers", async () => {
      setupGlobalMocks();

      const res = await request(app).get("/api/impact/global").expect(200);

      expect(res.headers["etag"]).toBeDefined();
      expect(res.headers["last-modified"]).toBeDefined();
      expect(res.headers["cache-control"]).toBe("public, max-age=300");
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalDonationsXLM).toBe("5000.0000000");
    });

    test("returns 304 Not Modified with no body when If-None-Match matches ETag", async () => {
      setupGlobalMocks();
      const res1 = await request(app).get("/api/impact/global").expect(200);
      const etag = res1.headers["etag"];

      const res2 = await request(app)
        .get("/api/impact/global")
        .set("If-None-Match", etag)
        .expect(304);

      expect(res2.text).toBe("");
    });

    test("returns 304 Not Modified with no body when If-None-Match is W/ (weak tag format)", async () => {
      setupGlobalMocks();
      const res1 = await request(app).get("/api/impact/global").expect(200);
      const etag = res1.headers["etag"];

      const res2 = await request(app)
        .get("/api/impact/global")
        .set("If-None-Match", `W/${etag}`)
        .expect(304);

      expect(res2.text).toBe("");
    });

    test("returns 304 Not Modified when If-Modified-Since is equal to or after Last-Modified date", async () => {
      setupGlobalMocks();
      const res1 = await request(app).get("/api/impact/global").expect(200);
      const lastModified = res1.headers["last-modified"];

      const res2 = await request(app)
        .get("/api/impact/global")
        .set("If-Modified-Since", lastModified)
        .expect(304);

      expect(res2.text).toBe("");
    });

    test("returns 200 OK when If-Modified-Since is prior to Last-Modified date", async () => {
      setupGlobalMocks();
      const olderDate = new Date("2025-01-01T00:00:00.000Z").toUTCString();

      const res = await request(app)
        .get("/api/impact/global")
        .set("If-Modified-Since", olderDate)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    test("updates produce updated ETag and Last-Modified headers", async () => {
      setupGlobalMocks();
      const res1 = await request(app).get("/api/impact/global").expect(200);

      cache.clear();
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              totalDonationsXLM: "6000.0000000",
              donorCount: 12,
              co2OffsetKg: "1200",
            },
          ],
        })
        .mockResolvedValueOnce(mockBreakdown)
        .mockResolvedValueOnce({
          rows: [
            {
              maxProjectUpdated: "2026-07-01T12:00:00.000Z",
              maxDonationCreated: "2026-07-02T12:00:00.000Z",
            },
          ],
        });

      const res2 = await request(app).get("/api/impact/global").expect(200);

      expect(res2.headers["etag"]).not.toBe(res1.headers["etag"]);
      expect(res2.headers["last-modified"]).not.toBe(res1.headers["last-modified"]);
    });

    test("ensures header stability across identical requests", async () => {
      setupGlobalMocks();
      const res1 = await request(app).get("/api/impact/global").expect(200);

      const res2 = await request(app).get("/api/impact/global").expect(200);

      expect(res2.headers["etag"]).toBe(res1.headers["etag"]);
      expect(res2.headers["last-modified"]).toBe(res1.headers["last-modified"]);
    });
  });

  describe("GET /api/impact/project/:id", () => {
    const projectId = "123e4567-e89b-12d3-a456-426614174000";
    const mockProject = {
      rows: [
        {
          id: projectId,
          category: "Ocean Clean",
          raised_xlm: "1000.0000000",
          co2_offset_kg: "500.0000000",
          updated_at: "2026-06-01T10:00:00.000Z",
          created_at: "2026-01-01T10:00:00.000Z",
        },
      ],
    };
    const mockDonations = {
      rows: [
        {
          totalDonationsXLM: "500.0000000",
          donorCount: 5,
          latestDonationAt: "2026-06-05T15:00:00.000Z",
        },
      ],
    };

    function setupProjectMocks() {
      pool.query
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockDonations);
    }

    test("returns 404 Not Found for non-existent project", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get(`/api/impact/project/${projectId}`).expect(404);
      expect(res.body.error).toBe("Project not found");
    });

    test("returns 200 OK with ETag and Last-Modified headers", async () => {
      setupProjectMocks();

      const res = await request(app).get(`/api/impact/project/${projectId}`).expect(200);

      expect(res.headers["etag"]).toBeDefined();
      expect(res.headers["last-modified"]).toBeDefined();
      expect(res.body.success).toBe(true);
      expect(res.body.data.donorCount).toBe(5);
    });

    test("returns 304 Not Modified when If-None-Match matches ETag", async () => {
      setupProjectMocks();
      const res1 = await request(app).get(`/api/impact/project/${projectId}`).expect(200);
      const etag = res1.headers["etag"];

      const res2 = await request(app)
        .get(`/api/impact/project/${projectId}`)
        .set("If-None-Match", etag)
        .expect(304);

      expect(res2.text).toBe("");
    });

    test("returns 304 Not Modified when If-Modified-Since matches Last-Modified", async () => {
      setupProjectMocks();
      const res1 = await request(app).get(`/api/impact/project/${projectId}`).expect(200);
      const lastModified = res1.headers["last-modified"];

      const res2 = await request(app)
        .get(`/api/impact/project/${projectId}`)
        .set("If-Modified-Since", lastModified)
        .expect(304);

      expect(res2.text).toBe("");
    });
  });

  describe("GET /api/impact/donor/:publicKey", () => {
    const validPublicKey = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335WF2CCAJ3KPXYSGEXZ6674AAA";
    const mockTotals = {
      rows: [
        {
          totalDonatedXLM: "250.0000000",
          projectsSupported: 3,
          co2OffsetKg: "120.0000000",
        },
      ],
    };
    const mockTopCategory = {
      rows: [{ category: "Reforestation", total: "200.0000000" }],
    };
    const mockTimestamps = {
      rows: [
        {
          maxDonationCreated: "2026-06-10T14:00:00.000Z",
          maxProjectUpdated: "2026-06-08T10:00:00.000Z",
        },
      ],
    };

    function setupDonorMocks() {
      pool.query
        .mockResolvedValueOnce(mockTotals)
        .mockResolvedValueOnce(mockTopCategory)
        .mockResolvedValueOnce(mockTimestamps);
    }

    test("returns 400 Bad Request for invalid Stellar public key", async () => {
      const res = await request(app).get("/api/impact/donor/invalid-key").expect(400);
      expect(res.body.error).toBe("Invalid Stellar public key");
    });

    test("returns 200 OK with ETag and Last-Modified headers", async () => {
      setupDonorMocks();

      const res = await request(app).get(`/api/impact/donor/${validPublicKey}`).expect(200);

      expect(res.headers["etag"]).toBeDefined();
      expect(res.headers["last-modified"]).toBeDefined();
      expect(res.body.success).toBe(true);
      expect(res.body.data.topCategory).toBe("Reforestation");
    });

    test("returns 304 Not Modified when If-None-Match matches ETag", async () => {
      setupDonorMocks();
      const res1 = await request(app).get(`/api/impact/donor/${validPublicKey}`).expect(200);
      const etag = res1.headers["etag"];

      const res2 = await request(app)
        .get(`/api/impact/donor/${validPublicKey}`)
        .set("If-None-Match", etag)
        .expect(304);

      expect(res2.text).toBe("");
    });

    test("returns 304 Not Modified when If-Modified-Since matches Last-Modified", async () => {
      setupDonorMocks();
      const res1 = await request(app).get(`/api/impact/donor/${validPublicKey}`).expect(200);
      const lastModified = res1.headers["last-modified"];

      const res2 = await request(app)
        .get(`/api/impact/donor/${validPublicKey}`)
        .set("If-Modified-Since", lastModified)
        .expect(304);

      expect(res2.text).toBe("");
    });
  });
});
