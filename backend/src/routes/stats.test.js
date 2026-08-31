"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../services/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
}));

const request = require("supertest");
const express = require("express");
const pool = require("../db/pool");
const redis = require("../services/redis");
const statsRouter = require("./stats");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/stats", statsRouter);
  app.use((err, _req, res, _next) => {
    res
      .status(err.status || 500)
      .json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("GET /api/stats/categories", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns project counts per category ordered by count descending", async () => {
    pool.query.mockResolvedValue({
      rows: [
        { category: "Reforestation", count: 3 },
        { category: "Solar Energy", count: 2 },
      ],
    });

    const res = await request(app)
      .get("/api/stats/categories")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      { category: "Reforestation", count: 3 },
      { category: "Solar Energy", count: 2 },
    ]);
    expect(res.body.data[0].count).toBeGreaterThan(
      res.body.data[1].count
    );

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("WHERE status = 'active'");
    expect(query).toContain("ORDER BY count DESC");
  });
});

describe("GET /api/stats/global", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns the aggregate landing-page hero stats and caches them in Redis for 60 seconds", async () => {
    redis.get.mockResolvedValue(null);

    pool.query.mockResolvedValue({
      rows: [
        {
          totalXLMRaised: "123456",
          totalCO2OffsetKg: 98765,
          totalDonations: 4321,
          totalProjects: 42,
          totalDonors: 1234,
        },
      ],
    });

    const res = await request(app)
      .get("/api/stats/global")
      .expect(200);

    expect(res.body).toEqual({
      totalXLMRaised: "123456.0000000",
      totalCO2OffsetKg: 98765,
      totalDonations: 4321,
      totalProjects: 42,
      totalDonors: 1234,
    });

    expect(redis.set).toHaveBeenCalledWith("stats:global", res.body, 60);
  });

  test("serves cached stats without querying Postgres", async () => {
    const cached = {
      totalXLMRaised: "10.0000000",
      totalCO2OffsetKg: 20,
      totalDonations: 3,
      totalProjects: 4,
      totalDonors: 5,
    };

    redis.get.mockResolvedValue(cached);

    const res = await request(app)
      .get("/api/stats/global")
      .expect(200);

    expect(res.body).toEqual(cached);
    expect(pool.query).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});