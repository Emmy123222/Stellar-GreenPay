"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/redis", () => ({ get: jest.fn(), set: jest.fn() }));

const request = require("supertest");
const express = require("express");
const pool = require("../db/pool");
const redis = require("../services/redis");
const impactRouter = require("./impact");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/impact", impactRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe("GET /api/impact/global", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns category breakdown with one entry per donated category and excludes empty categories", async () => {
    redis.get.mockResolvedValue(null);
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            totalDonationsXLM: "350",
            donorCount: 6,
            co2OffsetKg: 127,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            category: "Reforestation",
            totalDonationsXLM: "150",
            donorCount: 3,
            co2OffsetKg: 60,
          },
          {
            category: "Solar",
            totalDonationsXLM: "125",
            donorCount: 2,
            co2OffsetKg: 45,
          },
          {
            category: "Education",
            totalDonationsXLM: "75",
            donorCount: 1,
            co2OffsetKg: 22,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/api/impact/global").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.breakdownByCategory).toHaveLength(3);
    expect(res.body.data.breakdownByCategory).toEqual([
      {
        category: "Reforestation",
        totalDonationsXLM: "150.0000000",
        donorCount: 3,
        co2OffsetKg: 60,
      },
      {
        category: "Solar",
        totalDonationsXLM: "125.0000000",
        donorCount: 2,
        co2OffsetKg: 45,
      },
      {
        category: "Education",
        totalDonationsXLM: "75.0000000",
        donorCount: 1,
        co2OffsetKg: 22,
      },
    ]);

    expect(res.body.data.totalDonationsXLM).toBe("350.0000000");
    expect(res.body.data.co2OffsetKg).toBe(127);
    expect(redis.set).toHaveBeenCalledWith("/api/impact/global", res.body, 300);
  });
});

describe("GET /api/impact/project/:id (co2_per_xlm rate)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  function mockProjectImpact({ co2PerXlm, totalDonationsXLM }) {
    redis.get.mockResolvedValue(null);
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "proj-1",
            category: "Reforestation",
            raised_xlm: "1000",
            co2_offset_kg: "5000",
            co2_per_xlm: co2PerXlm,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            totalDonationsXLM,
            donorCount: 5,
            uniqueCountries: 2,
          },
        ],
      });
  }

  test("zero rate → null co2 with co2_rate_not_configured reason", async () => {
    mockProjectImpact({ co2PerXlm: "0", totalDonationsXLM: "100" });

    const res = await request(app).get("/api/impact/project/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.co2_kg).toBeNull();
    expect(res.body.data.co2OffsetKg).toBeNull();
    expect(res.body.data.reason).toBe("co2_rate_not_configured");
    // Top-level mirrors for the bare { co2_kg, reason } shape.
    expect(res.body.co2_kg).toBeNull();
    expect(res.body.reason).toBe("co2_rate_not_configured");
  });

  test("missing rate → null co2 with co2_rate_not_configured reason", async () => {
    mockProjectImpact({ co2PerXlm: null, totalDonationsXLM: "100" });

    const res = await request(app).get("/api/impact/project/proj-1").expect(200);

    expect(res.body.data.co2_kg).toBeNull();
    expect(res.body.data.reason).toBe("co2_rate_not_configured");
  });

  test("non-zero rate → total_donated_xlm * co2_per_xlm", async () => {
    mockProjectImpact({ co2PerXlm: "2.5", totalDonationsXLM: "100" });

    const res = await request(app).get("/api/impact/project/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.co2_kg).toBe(250);
    expect(res.body.data.co2OffsetKg).toBe(250);
    expect(res.body.data.reason).toBeNull();
    expect(res.body.co2_kg).toBe(250);
  });

  test("alias GET /api/impact/:projectId behaves the same", async () => {
    mockProjectImpact({ co2PerXlm: "0", totalDonationsXLM: "100" });

    const res = await request(app).get("/api/impact/proj-1").expect(200);

    expect(res.body.data.co2_kg).toBeNull();
    expect(res.body.data.reason).toBe("co2_rate_not_configured");
  });

  test("unknown project → 404", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app).get("/api/impact/project/does-not-exist").expect(404);
  });
});
