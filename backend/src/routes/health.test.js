"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/indexerService", () => ({
  getStatus: jest.fn(() => ({
    isRunning: false,
    lastProcessedLedger: 0,
    projectWalletsCount: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
  })),
}));

const request = require("supertest");
const express = require("express");
const pool = require("../db/pool");
const healthRouter = require("./health");

function buildApp() {
  const app = express();
  app.use("/api/health", healthRouter);
  return app;
}

describe("GET /api/health", () => {
  let app;
  const originalMaxFailed = process.env.PGBOSS_MAX_FAILED_JOBS;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    process.env.PGBOSS_MAX_FAILED_JOBS = "5";
  });

  afterAll(() => {
    if (originalMaxFailed === undefined) {
      delete process.env.PGBOSS_MAX_FAILED_JOBS;
    } else {
      process.env.PGBOSS_MAX_FAILED_JOBS = originalMaxFailed;
    }
  });

  test("includes pg-boss failed job count when under threshold", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] });

    const res = await request(app).get("/api/health").expect(200);

    expect(res.body.status).toBe("ok");
    expect(res.body.checks.db).toBe("ok");
    expect(res.body.checks.pgboss).toEqual({
      status: "ok",
      failedJobs: 2,
      maxFailedJobs: 5,
    });
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      "SELECT COUNT(*)::int AS count FROM pgboss.job WHERE state = $1",
      ["failed"]
    );
  });

  test("returns degraded and alerts when failed jobs exceed PGBOSS_MAX_FAILED_JOBS", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 12 }] });

    const res = await request(app).get("/api/health").expect(503);

    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.pgboss).toEqual({
      status: "alert",
      failedJobs: 12,
      maxFailedJobs: 5,
    });
  });

  test("returns degraded when database is unreachable", async () => {
    pool.query.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/api/health").expect(503);

    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.db).toBe("unreachable");
    expect(res.body.checks.pgboss).toEqual({
      status: "unreachable",
      failedJobs: null,
      maxFailedJobs: 5,
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
