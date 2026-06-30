"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
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

describe("GET /api/notifications/unread-count", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns unreadCount for followed project updates newer than lastSeen", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "device-token-id" }] })
      .mockResolvedValueOnce({ rows: [{ unread_count: "3" }] });

    const lastSeen = "2026-06-30T08:00:00.000Z";
    const res = await request(app)
      .get("/api/notifications/unread-count")
      .query({ token: "ExponentPushToken[abc]", lastSeen })
      .expect(200);

    expect(res.body).toEqual({ unreadCount: 3 });
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM device_tokens WHERE token = $1",
      ["ExponentPushToken[abc]"]
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("pu.created_at > $2"),
      ["device-token-id", lastSeen]
    );
  });

  test("counts all followed project updates when lastSeen is omitted", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "device-token-id" }] })
      .mockResolvedValueOnce({ rows: [{ unread_count: "7" }] });

    const res = await request(app)
      .get("/api/notifications/unread-count")
      .query({ token: "ExponentPushToken[abc]" })
      .expect(200);

    expect(res.body).toEqual({ unreadCount: 7 });
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.not.stringContaining("pu.created_at >"),
      ["device-token-id"]
    );
  });

  test("rejects requests without a token", async () => {
    const res = await request(app)
      .get("/api/notifications/unread-count")
      .expect(400);

    expect(res.body.error).toBe("token query parameter is required");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects invalid lastSeen timestamps", async () => {
    const res = await request(app)
      .get("/api/notifications/unread-count")
      .query({ token: "ExponentPushToken[abc]", lastSeen: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("lastSeen must be a valid ISO-8601 timestamp");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("returns 404 when the device token is not registered", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/notifications/unread-count")
      .query({ token: "ExponentPushToken[missing]" })
      .expect(404);

    expect(res.body.error).toBe("Device token not found");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
