"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const subscriptionsRouter = require("./subscriptions");
const { signUnsubscribeToken, verifyUnsubscribeToken } = require("../services/unsubscribeToken");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("unsubscribeToken service", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "mock-unsubscribe-jwt-secret";
    delete process.env.UNSUBSCRIBE_SECRET;
  });

  test("signs and verifies a token for email and projectId", () => {
    const token = signUnsubscribeToken("User@Example.com", "project-123");
    const parsed = verifyUnsubscribeToken(token);

    expect(parsed).toEqual({
      email: "user@example.com",
      projectId: "project-123",
    });
  });

  test("rejects tampered tokens", () => {
    const token = signUnsubscribeToken("user@example.com", "project-123");
    const tampered = `${token}x`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });
});

describe("GET /api/subscriptions/unsubscribe", () => {
  let app;

  beforeEach(() => {
    process.env.JWT_SECRET = "mock-unsubscribe-jwt-secret";
    delete process.env.UNSUBSCRIBE_SECRET;
    app = buildApp();
    jest.clearAllMocks();
  });

  test("removes the subscription and returns a confirmation page", async () => {
    const token = signUnsubscribeToken("user@example.com", "project-123");
    pool.query
      .mockResolvedValueOnce({ rows: [{ name: "Solar Forest" }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .get("/api/subscriptions/unsubscribe")
      .query({ token })
      .expect(200);

    expect(res.text).toContain("Unsubscribed");
    expect(res.text).toContain("Solar Forest");
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      "SELECT name FROM projects WHERE id = $1",
      ["project-123"],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      "DELETE FROM project_subscriptions WHERE project_id = $1 AND email = $2",
      ["project-123", "user@example.com"],
    );
  });

  test("rejects requests without a token", async () => {
    const res = await request(app)
      .get("/api/subscriptions/unsubscribe")
      .expect(400);

    expect(res.text).toContain("missing a token");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects invalid tokens", async () => {
    const res = await request(app)
      .get("/api/subscriptions/unsubscribe")
      .query({ token: "not-a-valid-token" })
      .expect(400);

    expect(res.text).toContain("invalid or has expired");
    expect(pool.query).not.toHaveBeenCalled();
  });
});
