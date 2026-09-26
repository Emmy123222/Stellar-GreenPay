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

describe("GET /api/stats/trends", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns week-over-week growth data and caches in Redis for 300 seconds", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          thisWeekXLM: "1250.0",
          lastWeekXLM: "980.0",
          thisWeekDonations: 42,
          lastWeekDonations: 35,
        },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual({
      thisWeekXLM: "1250.0000000",
      lastWeekXLM: "980.0000000",
      growthPercent: 27.55,
      thisWeekDonations: 42,
      lastWeekDonations: 35,
    });
    expect(redis.set).toHaveBeenCalledWith("stats:trends", res.body, 300);
  });

  test("serves cached trends without querying Postgres", async () => {
    const cached = {
      thisWeekXLM: "1250.0000000",
      lastWeekXLM: "980.0000000",
      growthPercent: 27.55,
      thisWeekDonations: 42,
      lastWeekDonations: 35,
    };
    redis.get.mockResolvedValue(cached);

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual(cached);
    expect(pool.query).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("returns growthPercent null when last week had zero donations", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          thisWeekXLM: "500.0",
          lastWeekXLM: "0",
          thisWeekDonations: 10,
          lastWeekDonations: 0,
        },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body.growthPercent).toBeNull();
    expect(res.body.thisWeekDonations).toBe(10);
    expect(res.body.lastWeekDonations).toBe(0);
  });

  test("returns growthPercent null and zero counts when no donations exist", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          thisWeekXLM: "0",
          lastWeekXLM: "0",
          thisWeekDonations: 0,
          lastWeekDonations: 0,
        },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual({
      thisWeekXLM: "0.0000000",
      lastWeekXLM: "0.0000000",
      growthPercent: null,
      thisWeekDonations: 0,
      lastWeekDonations: 0,
    });
  });

  test("returns negative growth when this week is lower than last week", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          thisWeekXLM: "500.0",
          lastWeekXLM: "1000.0",
          thisWeekDonations: 20,
          lastWeekDonations: 40,
        },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body.growthPercent).toBe(-50);
  });

  test("handles empty rows result gracefully", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual({
      thisWeekXLM: "0.0000000",
      lastWeekXLM: "0.0000000",
      growthPercent: null,
      thisWeekDonations: 0,
      lastWeekDonations: 0,
    });
  });

  test("returns 500 when pool.query throws", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockRejectedValue(new Error("DB connection failed"));

    const res = await request(app).get("/api/stats/trends").expect(500);

    expect(res.body.error).toBe("DB connection failed");
  });
});
