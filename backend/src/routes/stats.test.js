"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const statsRouter = require("./stats");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/stats", statsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("GET /api/stats/categories", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns project counts per category ordered by count descending", async () => {
    pool.query.mockResolvedValue({
      rows: [
        { category: "Reforestation", count: 3 },
        { category: "Solar Energy", count: 2 },
      ],
    });

    const res = await request(app).get("/api/stats/categories").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      { category: "Reforestation", count: 3 },
      { category: "Solar Energy", count: 2 },
    ]);
    expect(res.body.data[0].count).toBeGreaterThan(res.body.data[1].count);

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("WHERE status = 'active'");
    expect(query).toContain("ORDER BY count DESC");
  });
});
