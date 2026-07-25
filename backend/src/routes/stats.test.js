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
const { TRENDS_CACHE_KEY, TRENDS_CACHE_TTL_SECONDS } = require("./stats");

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

describe("GET /api/stats/trends", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns week-over-week XLM and donation counts with growthPercent, and caches for 5 minutes", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          thisWeekXLM:       "1250.0",
          lastWeekXLM:       "980.0",
          thisWeekDonations: 42,
          lastWeekDonations: 35,
        },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual({
      thisWeekXLM:       "1250.0000000",
      lastWeekXLM:       "980.0000000",
      growthPercent:     27.55,
      thisWeekDonations: 42,
      lastWeekDonations: 35,
    });
    expect(redis.set).toHaveBeenCalledWith(
      TRENDS_CACHE_KEY,
      res.body,
      TRENDS_CACHE_TTL_SECONDS
    );
  });

  test("serves cached trends without querying Postgres", async () => {
    const cached = {
      thisWeekXLM:       "1250.0000000",
      lastWeekXLM:       "980.0000000",
      growthPercent:     27.55,
      thisWeekDonations: 42,
      lastWeekDonations: 35,
    };
    redis.get.mockResolvedValue(cached);

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual(cached);
    expect(pool.query).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("returns growthPercent null when lastWeekXLM is zero (no previous-week donations)", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          thisWeekXLM:       "500.0",
          lastWeekXLM:       "0",
          thisWeekDonations: 10,
          lastWeekDonations: 0,
        },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body.growthPercent).toBeNull();
    expect(res.body.thisWeekXLM).toBe("500.0000000");
    expect(res.body.lastWeekXLM).toBe("0.0000000");
  });

  test("returns zero counts when donations table is empty", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          thisWeekXLM:       "0",
          lastWeekXLM:       "0",
          thisWeekDonations: 0,
          lastWeekDonations: 0,
        },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual({
      thisWeekXLM:       "0.0000000",
      lastWeekXLM:       "0.0000000",
      growthPercent:     null,
      thisWeekDonations: 0,
      lastWeekDonations: 0,
    });
  });

  test("propagates database errors to the error handler", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockRejectedValue(new Error("DB connection failed"));

    const res = await request(app).get("/api/stats/trends").expect(500);

    expect(res.body.error).toBe("DB connection failed");
  });
});
