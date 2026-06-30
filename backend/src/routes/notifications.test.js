"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const notificationsRouter = require("./notifications");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", notificationsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("POST /api/notifications/register", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.resetAllMocks();
  });

  test("inserts a new device token for a valid token and platform", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/notifications/register")
      .send({ token: "device-token-1", platform: "ios", walletAddress: "G123" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.tokenId).toBeDefined();
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test("upserts an existing device token and returns 200", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "token-1" }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/notifications/register")
      .send({ token: "existing-token", platform: "android", walletAddress: "G456" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.tokenId).toBe("token-1");
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test("returns 400 when platform is missing", async () => {
    const res = await request(app)
      .post("/api/notifications/register")
      .send({ token: "device-token-3" })
      .expect(400);

    expect(res.body.error).toContain("platform");
  });

  test("returns 400 when platform is invalid", async () => {
    const res = await request(app)
      .post("/api/notifications/register")
      .send({ token: "device-token-4", platform: "web" })
      .expect(400);

    expect(res.body.error).toContain("platform");
  });
});
