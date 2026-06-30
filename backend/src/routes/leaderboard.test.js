"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const pool = require("../db/pool");
const request = require("supertest");
const express = require("express");
const leaderboardRouter = require("./leaderboard");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/leaderboard", leaderboardRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

// Rows are already in DESC order, simulating what the DB ORDER BY returns.
const SORTED_DONORS = [
  {
    public_key: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    display_name: "Alice",
    badges: [{ tier: "earth", earnedAt: "2026-01-01T00:00:00.000Z" }],
    total_donated_xlm: "5000",
    projects_supported: 4,
  },
  {
    public_key: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    display_name: "Bob",
    badges: [{ tier: "forest", earnedAt: "2026-01-02T00:00:00.000Z" }],
    total_donated_xlm: "750",
    projects_supported: 2,
  },
  {
    public_key: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    display_name: null,
    badges: [],
    total_donated_xlm: "12",
    projects_supported: 1,
  },
];

describe("GET /api/leaderboard — ranking sort order", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("assigns rank 1 to the highest donor and increments for each subsequent entry", async () => {
    pool.query.mockResolvedValue({ rows: SORTED_DONORS });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data[0].rank).toBe(1);
    expect(res.body.data[1].rank).toBe(2);
    expect(res.body.data[2].rank).toBe(3);
  });

  test("preserves descending totalDonatedXLM order returned by the database", async () => {
    pool.query.mockResolvedValue({ rows: SORTED_DONORS });

    const res = await request(app).get("/api/leaderboard").expect(200);

    const totals = res.body.data.map((e) => Number(e.totalDonatedXLM));
    for (let i = 0; i < totals.length - 1; i++) {
      expect(totals[i]).toBeGreaterThanOrEqual(totals[i + 1]);
    }
  });

  test("rank 1 entry corresponds to the highest totalDonatedXLM", async () => {
    pool.query.mockResolvedValue({ rows: SORTED_DONORS });

    const res = await request(app).get("/api/leaderboard").expect(200);
    const first = res.body.data[0];

    expect(first.rank).toBe(1);
    expect(first.publicKey).toBe(SORTED_DONORS[0].public_key);
    expect(Number(first.totalDonatedXLM)).toBe(5000);
  });

  test("sets topBadge to the first badge tier when badges are present", async () => {
    pool.query.mockResolvedValue({ rows: SORTED_DONORS });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.data[0].topBadge).toBe("earth");
    expect(res.body.data[1].topBadge).toBe("forest");
  });

  test("sets topBadge to null when the donor has no badges", async () => {
    pool.query.mockResolvedValue({ rows: SORTED_DONORS });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.data[2].topBadge).toBeNull();
  });

  test("maps database snake_case fields to camelCase response shape", async () => {
    pool.query.mockResolvedValue({ rows: [SORTED_DONORS[0]] });

    const res = await request(app).get("/api/leaderboard").expect(200);
    const entry = res.body.data[0];

    expect(entry).toMatchObject({
      rank: 1,
      publicKey: SORTED_DONORS[0].public_key,
      displayName: "Alice",
      totalDonatedXLM: "5000",
      projectsSupported: 4,
      topBadge: "earth",
    });
  });

  test("sets displayName to null when the profile has no display name", async () => {
    pool.query.mockResolvedValue({ rows: [SORTED_DONORS[2]] });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.data[0].displayName).toBeNull();
  });

  test("returns an empty data array when no profiles exist", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /api/leaderboard — limit handling", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test("passes a default limit of 20 to the database when not specified", async () => {
    await request(app).get("/api/leaderboard").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [20]);
  });

  test("respects a custom limit within bounds", async () => {
    await request(app).get("/api/leaderboard?limit=5").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [5]);
  });

  test("caps the limit at 100 when a larger value is requested", async () => {
    await request(app).get("/api/leaderboard?limit=500").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [100]);
  });

  test("falls back to default limit of 20 when limit is non-numeric", async () => {
    await request(app).get("/api/leaderboard?limit=abc").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [20]);
  });
});
