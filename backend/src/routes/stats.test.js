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

  test("returns week-over-week growth data and caches in Redis for 60 seconds", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        { week: "this_week", total_xlm: "1250.0", total_donations: "42" },
        { week: "last_week", total_xlm: "980.0",  total_donations: "35" },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual({
      thisWeekXLM: "1250.0",
      lastWeekXLM: "980.0",
      growthPercent: 27.55,
      thisWeekDonations: 42,
      lastWeekDonations: 35,
    });
    expect(redis.set).toHaveBeenCalledWith("stats:trends", res.body, 60);
  });

  test("serves cached trends without querying Postgres", async () => {
    const cached = {
      thisWeekXLM: "1250.0",
      lastWeekXLM: "980.0",
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

  test("returns zero growth when both weeks have no donations", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body).toEqual({
      thisWeekXLM: "0.0",
      lastWeekXLM: "0.0",
      growthPercent: 0,
      thisWeekDonations: 0,
      lastWeekDonations: 0,
    });
  });

  test("returns 100% growth when last week was zero but this week has donations", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        { week: "this_week", total_xlm: "500.0", total_donations: "10" },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body.growthPercent).toBe(100);
    expect(res.body.thisWeekDonations).toBe(10);
    expect(res.body.lastWeekDonations).toBe(0);
  });

  test("returns negative growth when this week is lower than last week", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        { week: "this_week", total_xlm: "500.0",  total_donations: "20" },
        { week: "last_week", total_xlm: "1000.0", total_donations: "40" },
      ],
    });

    const res = await request(app).get("/api/stats/trends").expect(200);

    expect(res.body.growthPercent).toBe(-50);
  });

  test("returns 500 when pool.query throws", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockRejectedValue(new Error("DB connection failed"));

    const res = await request(app).get("/api/stats/trends").expect(500);

    expect(res.body.error).toBe("DB connection failed");
  });
});

describe("computeGrowthPercent", () => {
  const { computeGrowthPercent } = require("./stats");

  test("returns 0 when both values are zero", () => {
    expect(computeGrowthPercent(0, 0)).toBe(0);
  });

  test("returns 100 when last week is zero but this week is positive", () => {
    expect(computeGrowthPercent(500, 0)).toBe(100);
  });

  test("calculates positive growth correctly", () => {
    expect(computeGrowthPercent(1250, 980)).toBeCloseTo(27.55, 1);
  });

  test("calculates negative growth correctly", () => {
    expect(computeGrowthPercent(500, 1000)).toBe(-50);
  });
});
