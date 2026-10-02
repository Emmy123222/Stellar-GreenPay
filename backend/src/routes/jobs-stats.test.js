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
const jobsRouter = require("./jobs");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/jobs", jobsRouter);
  app.use((err, _req, res, _next) => {
    void _next;
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe("GET /api/jobs/stats", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns aggregate escrow marketplace metrics and caches them in Redis for 60 seconds", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          totalJobsInEscrow: 12,
          totalJobsCompleted: 45,
          totalEscrowXLM: "12500.0000000",
          totalReleasedXLM: "8200.0000000",
        },
      ],
    });

    const res = await request(app).get("/api/jobs/stats").expect(200);

    expect(res.body).toEqual({
      totalJobsInEscrow: 12,
      totalJobsCompleted: 45,
      totalEscrowXLM: "12500.0000000",
      totalReleasedXLM: "8200.0000000",
    });
    expect(redis.set).toHaveBeenCalledWith("jobs:stats", res.body, 60);
  });

  test("serves cached stats without querying Postgres", async () => {
    const cached = {
      totalJobsInEscrow: 5,
      totalJobsCompleted: 10,
      totalEscrowXLM: "1000.0000000",
      totalReleasedXLM: "500.0000000",
    };
    redis.get.mockResolvedValue(cached);

    const res = await request(app).get("/api/jobs/stats").expect(200);

    expect(res.body).toEqual(cached);
    expect(pool.query).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("returns zeroed values when the jobs table is empty", async () => {
    redis.get.mockResolvedValue(null);
    pool.query.mockResolvedValue({
      rows: [
        {
          totalJobsInEscrow: 0,
          totalJobsCompleted: 0,
          totalEscrowXLM: "0",
          totalReleasedXLM: "0",
        },
      ],
    });

    const res = await request(app).get("/api/jobs/stats").expect(200);

    expect(res.body).toEqual({
      totalJobsInEscrow: 0,
      totalJobsCompleted: 0,
      totalEscrowXLM: "0.0000000",
      totalReleasedXLM: "0.0000000",
    });
  });

  test("does not clash with GET /api/jobs/:id", async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: "abc-123", title: "Test Job" }],
    });

    const res = await request(app).get("/api/jobs/abc-123").expect(200);

    // It should resolve to the :id route, not /stats
    expect(res.body).toHaveProperty("data");
    expect(res.body.success).toBe(true);
  });
});
