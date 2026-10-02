"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/redis", () => ({ ping: jest.fn() }));

const request = require("supertest");
const express = require("express");
const pool = require("../db/pool");
const redis = require("../services/redis");
const readinessRouter = require("./readiness");

function buildApp() {
  const app = express();
  app.use("/api/readiness", readinessRouter);
  return app;
}

describe("GET /api/readiness", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns ok when the database and Redis are reachable", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    redis.ping.mockResolvedValueOnce("PONG");

    const res = await request(app).get("/api/readiness").expect(200);

    expect(res.body.status).toBe("ok");
    expect(res.body.checks).toEqual({ db: "ok", redis: "ok" });
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
    expect(redis.ping).toHaveBeenCalledTimes(1);
  });

  test("returns degraded when a dependency fails", async () => {
    pool.query.mockRejectedValueOnce(new Error("connection refused"));
    redis.ping.mockResolvedValueOnce("PONG");

    const res = await request(app).get("/api/readiness").expect(503);

    expect(res.body.status).toBe("degraded");
    expect(res.body.checks).toEqual({ db: "error", redis: "ok" });
  });

  test("returns degraded when a dependency exceeds the two-second timeout", async () => {
    pool.query.mockReturnValueOnce(new Promise(() => {}));
    redis.ping.mockResolvedValueOnce("PONG");

    const res = await request(app).get("/api/readiness");

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ db: "error", redis: "ok" });
  });
});