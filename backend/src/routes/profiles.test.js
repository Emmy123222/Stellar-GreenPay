"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const profilesRouter = require("./profiles");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/profiles", profilesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("POST /api/profiles", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("rejects HTML in profile display name with 422 field errors", async () => {
    const res = await request(app)
      .post("/api/profiles")
      .send({
        publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        displayName: "<b>Bad</b>",
        bio: "A short bio",
      })
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.displayName).toBeDefined();
  });
});
