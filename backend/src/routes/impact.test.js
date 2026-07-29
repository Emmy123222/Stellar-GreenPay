"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/cache", () => ({
  get: jest.fn(() => null),
  set: jest.fn((_, v) => v),
}));

const pool = require("../db/pool");
const request = require("supertest");
const express = require("express");
const impactRouter = require("./impact");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/impact", impactRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

const ZERO_DONOR_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("GET /api/impact/donor/:publicKey — no donations", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns 200 (not 404) with the zero-value shape when the donor has no donation history", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { totalDonatedXLM: "0", projectsSupported: 0, co2OffsetKg: "0" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/impact/donor/${ZERO_DONOR_KEY}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      totalDonatedXLM: "0.0000000",
      co2OffsetKg: 0,
      projectsSupported: 0,
      topCategory: null,
    });
  });

  test("does not return a 404 or an empty body for a donor with zero donations", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { totalDonatedXLM: "0", projectsSupported: 0, co2OffsetKg: "0" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(
      `/api/impact/donor/${ZERO_DONOR_KEY}`,
    );

    expect(res.status).not.toBe(404);
    expect(res.body.data).toBeDefined();
  });

  test("returns 400 for an invalid public key", async () => {
    const res = await request(app)
      .get("/api/impact/donor/not-a-valid-key")
      .expect(400);

    expect(res.body.error).toBe("Invalid Stellar public key");
  });
});
