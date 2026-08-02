"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));

// Mock the rate limiter so it is transparent for all existing tests.
// Individual tests that need to verify rate-limit behaviour re-require
// the router with a blocking mock.
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: jest.fn(() => (_req, _res, next) => next()),
}));

const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
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
    total_co2_offset_kg: "1250.5",
    impact_score: "3525.375",
    projects_supported: 4,
  },
  {
    public_key: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    display_name: "Bob",
    badges: [{ tier: "forest", earnedAt: "2026-01-02T00:00:00.000Z" }],
    total_donated_xlm: "750",
    total_co2_offset_kg: "180",
    impact_score: "525.54",
    projects_supported: 2,
  },
  {
    public_key: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    display_name: null,
    badges: [],
    total_donated_xlm: "12",
    total_co2_offset_kg: "0",
    impact_score: "8.4",
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
      totalCO2OffsetKg: "1250.5",
      projectsSupported: 4,
      topBadge: "earth",
    });
  });

  test("exposes totalCO2OffsetKg as a string from total_co2_offset_kg", async () => {
    pool.query.mockResolvedValue({ rows: [SORTED_DONORS[0]] });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.data[0].totalCO2OffsetKg).toBe("1250.5");
  });

  test("defaults totalCO2OffsetKg to \"0\" when co2 offset is missing", async () => {
    pool.query.mockResolvedValue({
      rows: [{ ...SORTED_DONORS[2], total_co2_offset_kg: null }],
    });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.data[0].totalCO2OffsetKg).toBe("0");
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

describe("GET /api/leaderboard/history", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("groups leaderboard entries by YYYY-MM format", async () => {
    const mockRows = [
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        display_name: "Alice",
        total_xlm_that_month: "5000",
        badge: "earth",
        rank: 1,
      },
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        display_name: "Bob",
        total_xlm_that_month: "750",
        badge: "forest",
        rank: 2,
      },
      {
        month: new Date("2025-12-15T00:00:00.000Z"),
        donor_address: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        display_name: "Charlie",
        total_xlm_that_month: "3000",
        badge: "ocean",
        rank: 1,
      },
      {
        month: new Date("2025-11-15T00:00:00.000Z"),
        donor_address: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        display_name: "Diana",
        total_xlm_that_month: "2000",
        badge: "sun",
        rank: 1,
      },
    ];

    pool.query.mockResolvedValue({ rows: mockRows });

    const res = await request(app).get("/api/leaderboard/history").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);

    expect(res.body.data[0].month).toBe("2026-01");
    expect(res.body.data[0].entries).toHaveLength(2);
    expect(res.body.data[1].month).toBe("2025-12");
    expect(res.body.data[1].entries).toHaveLength(1);
    expect(res.body.data[2].month).toBe("2025-11");
    expect(res.body.data[2].entries).toHaveLength(1);
  });

  test("returns only the last 2 months when ?months=2 is specified", async () => {
    const mockRows = [
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        display_name: "Alice",
        total_xlm_that_month: "5000",
        badge: "earth",
        rank: 1,
      },
      {
        month: new Date("2025-12-15T00:00:00.000Z"),
        donor_address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        display_name: "Bob",
        total_xlm_that_month: "750",
        badge: "forest",
        rank: 1,
      },
    ];

    pool.query.mockResolvedValue({ rows: mockRows });

    const res = await request(app).get("/api/leaderboard/history?months=2").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [2]);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].month).toBe("2026-01");
    expect(res.body.data[1].month).toBe("2025-12");
  });

  test("sorts entries by rank ASC within each month", async () => {
    const mockRows = [
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        display_name: "Bob",
        total_xlm_that_month: "750",
        badge: "forest",
        rank: 1,
      },
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        display_name: "Charlie",
        total_xlm_that_month: "3000",
        badge: "ocean",
        rank: 2,
      },
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        display_name: "Alice",
        total_xlm_that_month: "5000",
        badge: "earth",
        rank: 3,
      },
    ];

    pool.query.mockResolvedValue({ rows: mockRows });

    const res = await request(app).get("/api/leaderboard/history").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entries).toHaveLength(3);

    const ranks = res.body.data[0].entries.map((e) => e.rank);
    expect(ranks).toEqual([1, 2, 3]);
  });

  test("maps database snake_case fields to camelCase response shape", async () => {
    const mockRows = [
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        display_name: "Alice",
        total_xlm_that_month: "5000",
        badge: "earth",
        rank: 1,
      },
    ];

    pool.query.mockResolvedValue({ rows: mockRows });

    const res = await request(app).get("/api/leaderboard/history").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data[0].month).toBe("2026-01");
    expect(res.body.data[0].entries[0]).toMatchObject({
      rank: 1,
      donorAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      displayName: "Alice",
      totalXLMThatMonth: "5000",
      badge: "earth",
    });
  });

  test("sets displayName to null when display_name is null", async () => {
    const mockRows = [
      {
        month: new Date("2026-01-15T00:00:00.000Z"),
        donor_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        display_name: null,
        total_xlm_that_month: "5000",
        badge: null,
        rank: 1,
      },
    ];

    pool.query.mockResolvedValue({ rows: mockRows });

    const res = await request(app).get("/api/leaderboard/history").expect(200);

    expect(res.body.data[0].entries[0].displayName).toBeNull();
    expect(res.body.data[0].entries[0].badge).toBeNull();
  });

  test("returns empty array when no monthly leaderboard data exists", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/leaderboard/history").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  test("caps months parameter at 24 when larger value is requested", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/leaderboard/history?months=50").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [24]);
  });

  test("uses default of 12 months when not specified", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/leaderboard/history").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [12]);
  });
});

describe("GET /api/leaderboard — rate limiting (issue #695)", () => {
  test("createRateLimiter is called with (30, 1) — 30 req/min per IP", () => {
    expect(createRateLimiter).toHaveBeenCalledWith(30, 1);
  });

  test("GET / returns 429 with Retry-After when the limiter blocks the request", async () => {
    jest.resetModules();
    jest.mock("../db/pool", () => ({ query: jest.fn() }));
    jest.mock("../middleware/rateLimiter", () => ({
      createRateLimiter: jest.fn(() => (_req, res) => {
        res.set("Retry-After", "60");
        return res.status(429).json({ message: "Too many requests — Try again later." });
      }),
    }));

    const blockedRouter = require("./leaderboard");
    const app = express();
    app.use(express.json());
    app.use("/api/leaderboard", blockedRouter);

    const res = await request(app).get("/api/leaderboard");
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many requests/i);
    expect(res.headers["retry-after"]).toBe("60");
  });

  test("GET /history returns 429 with Retry-After when the limiter blocks the request", async () => {
    jest.resetModules();
    jest.mock("../db/pool", () => ({ query: jest.fn() }));
    jest.mock("../middleware/rateLimiter", () => ({
      createRateLimiter: jest.fn(() => (_req, res) => {
        res.set("Retry-After", "60");
        return res.status(429).json({ message: "Too many requests — Try again later." });
      }),
    }));

    const blockedRouter = require("./leaderboard");
    const app = express();
    app.use(express.json());
    app.use("/api/leaderboard", blockedRouter);

    const res = await request(app).get("/api/leaderboard/history");
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many requests/i);
    expect(res.headers["retry-after"]).toBe("60");
  });
});