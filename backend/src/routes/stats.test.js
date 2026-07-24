"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
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
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

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

    const res = await request(app).get("/api/stats/global").expect(200);

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

    const res = await request(app).get("/api/stats/global").expect(200);

    expect(res.body).toEqual(cached);
    expect(pool.query).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe("GET /api/stats/categories", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns active project counts grouped by category ordered by count desc", async () => {
    pool.query.mockResolvedValue({
      rows: [
        { category: "Reforestation", count: 10 },
        { category: "Solar Energy", count: 7 },
        { category: "Ocean Conservation", count: 3 },
      ],
    });

    const res = await request(app).get("/api/stats/categories").expect(200);

    expect(res.body).toEqual({
      success: true,
      data: [
        { category: "Reforestation", count: 10 },
        { category: "Solar Energy", count: 7 },
        { category: "Ocean Conservation", count: 3 },
      ],
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("returns empty data array when no active projects exist", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/stats/categories").expect(200);

    expect(res.body).toEqual({ success: true, data: [] });
  });

  test("propagates database errors through Express error handler", async () => {
    pool.query.mockRejectedValue(new Error("db down"));

    const res = await request(app).get("/api/stats/categories");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "db down" });
  });
});
