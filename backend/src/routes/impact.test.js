"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/cache", () => ({ get: jest.fn(), set: jest.fn() }));

const request = require("supertest");
const express = require("express");
const pool = require("../db/pool");
const cache = require("../services/cache");
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

describe("GET /api/impact/global", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns category breakdown with one entry per donated category and excludes empty categories", async () => {
    cache.get.mockReturnValue(null);
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            totalDonationsXLM: "350",
            donorCount: 6,
            co2OffsetKg: 127,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            category: "Reforestation",
            totalDonationsXLM: "150",
            donorCount: 3,
            co2OffsetKg: 60,
          },
          {
            category: "Solar",
            totalDonationsXLM: "125",
            donorCount: 2,
            co2OffsetKg: 45,
          },
          {
            category: "Education",
            totalDonationsXLM: "75",
            donorCount: 1,
            co2OffsetKg: 22,
          },
        ],
      });

    const res = await request(app).get("/api/impact/global").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.breakdownByCategory).toHaveLength(3);
    expect(res.body.data.breakdownByCategory).toEqual([
      {
        category: "Reforestation",
        totalDonationsXLM: "150.0000000",
        donorCount: 3,
        co2OffsetKg: 60,
      },
      {
        category: "Solar",
        totalDonationsXLM: "125.0000000",
        donorCount: 2,
        co2OffsetKg: 45,
      },
      {
        category: "Education",
        totalDonationsXLM: "75.0000000",
        donorCount: 1,
        co2OffsetKg: 22,
      },
    ]);

    expect(res.body.data.totalDonationsXLM).toBe("350.0000000");
    expect(res.body.data.co2OffsetKg).toBe(127);
    expect(cache.set).toHaveBeenCalledWith("/api/impact/global", res.body, 300000);
  });
});
