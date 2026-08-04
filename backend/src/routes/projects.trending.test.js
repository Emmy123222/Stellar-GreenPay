/**
 * Unit tests: GET /api/projects/trending — trending projects endpoint
 *
 * Strategy
 * --------
 * Mock pool.query to return pre-computed rows so we can verify the route
 * logic (ordering, limit, caching) without needing a real database.
 */
"use strict";

// ─── Module mocks (must come before any require) ─────────────────────────────

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));

jest.mock("../services/redis", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue("OK"),
}));

jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn(),
  CONTRACT_ID: "test-contract-id",
  server: {},
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

jest.mock("../services/summaryQueue", () => ({
  enqueueAISummary: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const redis = require("../services/redis");
const projectsRouter = require("./projects");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Express app that mounts the projects router. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  app.use((err, _req, res, _next) => {
    res
      .status(err.status || 500)
      .json({ error: err.message || "Internal server error" });
  });
  return app;
}

/**
 * Generate mock project rows with computed trending fields as the route
 * would see them after its SQL query.
 *
 * Rows are returned in descending trending_score order (highest first).
 */
function generateTrendingRows() {
  return [
    {
      id: "proj-hot-1",
      name: "Trending Project Alpha",
      description: "A fast-rising reforestation project",
      category: "Reforestation",
      location: "Brazil",
      wallet_address:
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      goal_xlm: "50000",
      raised_xlm: "25000",
      donor_count: 120,
      co2_offset_kg: 50000,
      status: "active",
      verified: true,
      on_chain_verified: false,
      tags: ["reforestation"],
      created_at: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      updated_at: new Date("2026-06-15T00:00:00.000Z").toISOString(),
      donations_last_7_days: 28,
      donations_last_30_days: 70,
      trending_score: 1.5,
    },
    {
      id: "proj-hot-2",
      name: "Trending Project Beta",
      description: "A moderately rising solar energy project",
      category: "Solar Energy",
      location: "Kenya",
      wallet_address:
        "GBVNQON4MFVGJXK5WT7VQJJZXFVHZJB6BHFWJCW7OF5BLNGOLZJQHIY",
      goal_xlm: "75000",
      raised_xlm: "30000",
      donor_count: 80,
      co2_offset_kg: 100000,
      status: "active",
      verified: true,
      on_chain_verified: true,
      tags: ["solar", "africa"],
      created_at: new Date("2026-05-15T00:00:00.000Z").toISOString(),
      updated_at: new Date("2026-06-15T00:00:00.000Z").toISOString(),
      donations_last_7_days: 14,
      donations_last_30_days: 60,
      trending_score: 0.8696,
    },
    {
      id: "proj-hot-3",
      name: "Trending Project Gamma",
      description: "A steady ocean conservation project",
      category: "Ocean Conservation",
      location: "Pacific Ocean",
      wallet_address:
        "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP",
      goal_xlm: "100000",
      raised_xlm: "15000",
      donor_count: 50,
      co2_offset_kg: 30000,
      status: "active",
      verified: false,
      on_chain_verified: false,
      tags: ["ocean"],
      created_at: new Date("2026-04-01T00:00:00.000Z").toISOString(),
      updated_at: new Date("2026-06-10T00:00:00.000Z").toISOString(),
      donations_last_7_days: 7,
      donations_last_30_days: 35,
      trending_score: 0.6316,
    },
    {
      id: "proj-zero",
      name: "Zero-Donation Project",
      description: "A project with no donations yet",
      category: "Clean Water",
      location: "Mali",
      wallet_address:
        "GBSJ7KFU2NXACVHVN2VWIMFZQMQM4NJJ7NKFRRL2GWWI5EKWGYNIFZ7",
      goal_xlm: "30000",
      raised_xlm: "0",
      donor_count: 0,
      co2_offset_kg: 0,
      status: "active",
      verified: false,
      on_chain_verified: false,
      tags: ["water"],
      created_at: new Date("2026-06-20T00:00:00.000Z").toISOString(),
      updated_at: new Date("2026-06-20T00:00:00.000Z").toISOString(),
      donations_last_7_days: 0,
      donations_last_30_days: 0,
      trending_score: 0,
    },
  ];
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("GET /api/projects/trending", () => {
  let app;
  const TRENDING_ROWS = generateTrendingRows();

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();

    // Default: cache miss so every request hits pool.query
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue("OK");

    // Mock pool.query to return our trending rows
    pool.query.mockResolvedValue({ rows: TRENDING_ROWS });
  });

  // ── Basic response shape ──────────────────────────────────────────────────

  test("returns success: true and a data array", async () => {
    const res = await request(app).get("/api/projects/trending").expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // ── Ordering ──────────────────────────────────────────────────────────────

  test("returns projects ordered by trending_score descending", async () => {
    const res = await request(app).get("/api/projects/trending").expect(200);

    const scores = res.body.data.map((p) => p.trendingScore);
    // Scores should be descending
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }

    // First project should be the highest trending
    expect(res.body.data[0].id).toBe("proj-hot-1");
    expect(res.body.data[0].trendingScore).toBe(1.5);
  });

  // ── Additional fields ─────────────────────────────────────────────────────

  test("each project has trendingScore, donationsLast7Days, donationsLast30Days", async () => {
    const res = await request(app).get("/api/projects/trending").expect(200);

    for (const project of res.body.data) {
      expect(project).toHaveProperty("trendingScore");
      expect(project).toHaveProperty("donationsLast7Days");
      expect(project).toHaveProperty("donationsLast30Days");
      expect(typeof project.trendingScore).toBe("number");
      expect(typeof project.donationsLast7Days).toBe("number");
      expect(typeof project.donationsLast30Days).toBe("number");
    }
  });

  // ── Zero-donation projects included ───────────────────────────────────────

  test("includes projects with zero donations (trendingScore = 0)", async () => {
    const res = await request(app).get("/api/projects/trending").expect(200);

    const zeroScoreProject = res.body.data.find(
      (p) => p.id === "proj-zero",
    );
    expect(zeroScoreProject).toBeDefined();
    expect(zeroScoreProject.trendingScore).toBe(0);
    expect(zeroScoreProject.donationsLast7Days).toBe(0);
    expect(zeroScoreProject.donationsLast30Days).toBe(0);

    // Zero-donation project should sort last
    expect(res.body.data[res.body.data.length - 1].id).toBe("proj-zero");
  });

  // ── Limit parameter ───────────────────────────────────────────────────────

  test("respects ?limit=2 query param", async () => {
    const res = await request(app)
      .get("/api/projects/trending?limit=2")
      .expect(200);

    expect(res.body.data).toHaveLength(2);
  });

  test("caps limit at 50", async () => {
    const res = await request(app)
      .get("/api/projects/trending?limit=100")
      .expect(200);

    // pool.query was called with limit=50
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      [50],
    );
  });

  test("defaults to 10 when no limit is provided", async () => {
    await request(app).get("/api/projects/trending").expect(200);

    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      [10],
    );
  });

  test("uses default 10 when limit is NaN", async () => {
    await request(app)
      .get("/api/projects/trending?limit=abc")
      .expect(200);

    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      [10],
    );
  });

  // ── Standard project fields mapped ────────────────────────────────────────

  test("each project has standard mapped fields (camelCase)", async () => {
    const res = await request(app).get("/api/projects/trending").expect(200);

    const project = res.body.data[0];
    expect(project).toHaveProperty("id");
    expect(project).toHaveProperty("name");
    expect(project).toHaveProperty("description");
    expect(project).toHaveProperty("category");
    expect(project).toHaveProperty("walletAddress");
    expect(project).toHaveProperty("raisedXLM");
    expect(project).toHaveProperty("status");
    expect(project).toHaveProperty("createdAt");
  });

  // ── Caching ───────────────────────────────────────────────────────────────

  test("serves from cache on second call without hitting pool.query again", async () => {
    // First call: cache miss → hits pool.query
    await request(app).get("/api/projects/trending").expect(200);
    expect(pool.query).toHaveBeenCalledTimes(1);

    // Second call: cache hit, return cached payload
    const cachedResponse = {
      success: true,
      data: [
        {
          id: "cached-proj",
          name: "Cached Project",
          trendingScore: 2.0,
          donationsLast7Days: 10,
          donationsLast30Days: 20,
        },
      ],
    };
    redis.get.mockResolvedValue(cachedResponse);

    const res = await request(app).get("/api/projects/trending").expect(200);

    // pool.query should still have been called only once
    expect(pool.query).toHaveBeenCalledTimes(1);
    // The response should be the cached payload
    expect(res.body).toEqual(cachedResponse);
  });

  // ── Cache key includes limit ──────────────────────────────────────────────

  test("uses cache key 'projects:trending:' + limit", async () => {
    await request(app)
      .get("/api/projects/trending?limit=5")
      .expect(200);

    expect(redis.get).toHaveBeenCalledWith("projects:trending:5");
    expect(redis.set).toHaveBeenCalledWith(
      "projects:trending:5",
      expect.any(Object),
      300,
    );
  });
});
