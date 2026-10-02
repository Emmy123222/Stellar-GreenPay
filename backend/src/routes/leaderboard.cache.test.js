/**
 * src/routes/leaderboard.cache.test.js
 * Unit tests for the Redis result cache and query-duration histogram added to
 * GET /api/leaderboard for issue #1093.
 *
 * The doubles below are `mock`-prefixed because jest.mock() factories are hoisted
 * above the variable declarations and Jest only lets them close over names
 * starting with `mock`.
 */
"use strict";

const express = require("express");
const request = require("supertest");

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQueries = [];

jest.mock("../db/pool", () => ({
  query: jest.fn().mockImplementation((sql) => {
    mockQueries.push({ sql });
    return {
      rows: [
        {
          public_key: "GDFQD3P23BO4QIQ3VO3PQD7YJQP2O4RJQXZP4YQOK4Z3U6QMAQVAAAAB",
          display_name: "Alice",
          badges: [{ tier: "seedling" }],
          total_donated_xlm: "120.5000000",
          projects_supported: 4,
          total_co2_offset_kg: "80.0000000",
          impact_score: "109.5500000",
        },
      ],
    };
  }),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: jest.fn(() => (_req, _res, next) => next()),
}));

/** Hand-rolled cache stand-in so the tests can assert keys, TTLs and hit/miss. */
const mockStore = new Map();
const mockRedis = {
  get: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
  set: jest.fn(async (key, value) => {
    mockStore.set(key, value);
  }),
  deletePattern: jest.fn(async () => {}),
};
jest.mock("../services/redis", () => ({
  get: (...args) => mockRedis.get(...args),
  set: (...args) => mockRedis.set(...args),
  deletePattern: (...args) => mockRedis.deletePattern(...args),
}));

/** Histogram double: records every startTimer call and its labels. */
const mockObserveDuration = jest.fn();
const mockStartTimer = jest.fn(() => mockObserveDuration);
jest.mock("../services/metrics", () => ({
  leaderboardQueryDuration: {
    startTimer: (labels) => mockStartTimer(labels),
  },
}));

const leaderboardRouter = require("./leaderboard");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp() {
  const app = express();
  app.use("/api/leaderboard", leaderboardRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

function resetAll() {
  mockQueries.length = 0;
  mockStore.clear();
  jest.clearAllMocks();
}

const app = createApp();

describe("GET /api/leaderboard cache (issue #1093)", () => {
  beforeEach(resetAll);

  test("serves a repeat request from cache and returns the same page", async () => {
    const first = await request(app).get("/api/leaderboard?limit=10");
    const second = await request(app).get("/api/leaderboard?limit=10");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The aggregate query is the thing being avoided — one round trip, not two.
    expect(mockQueries).toHaveLength(1);
    expect(second.body).toEqual(first.body);
    expect(second.body.data[0]).toMatchObject({ rank: 1, displayName: "Alice" });
  });

  test("caches under a leaderboard: key with a 60 second TTL", async () => {
    await request(app).get("/api/leaderboard?limit=10");

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const [key, , ttl] = mockRedis.set.mock.calls[0];
    expect(key).toMatch(/^leaderboard:/);
    expect(ttl).toBe(60);
  });

  test("keys the cache on the page size so pages never share an entry", async () => {
    await request(app).get("/api/leaderboard?limit=10");
    await request(app).get("/api/leaderboard?limit=20");

    expect(mockQueries).toHaveLength(2);
    const keys = mockRedis.set.mock.calls.map((call) => call[0]);
    expect(new Set(keys).size).toBe(2);
  });

  test("keys the cache on cursor, sort, period and verification filters", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ total_donated_xlm: "100", publicKey: "GABC" }),
    ).toString("base64");

    await request(app).get("/api/leaderboard?limit=10");
    await request(app).get(`/api/leaderboard?limit=10&cursor=${cursor}`);
    await request(app).get("/api/leaderboard?limit=10&sortBy=impactScore");
    await request(app).get("/api/leaderboard?limit=10&period=month");
    await request(app).get("/api/leaderboard?limit=10&onlyVerified=true");

    expect(mockQueries).toHaveLength(5);
    const keys = mockRedis.set.mock.calls.map((call) => call[0]);
    expect(new Set(keys).size).toBe(5);
  });

  test("falls back to Postgres when the cache yields nothing", async () => {
    // services/redis.js resolves get() to null on any connection failure, so an
    // unavailable Redis looks exactly like a cold cache to this route — the
    // endpoint must keep serving from Postgres rather than erroring.
    mockRedis.get.mockImplementationOnce(async () => null);

    const res = await request(app).get("/api/leaderboard?limit=10");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockQueries).toHaveLength(1);
  });

  test("times the query only when it actually reaches Postgres", async () => {
    await request(app).get("/api/leaderboard?limit=10");
    await request(app).get("/api/leaderboard?limit=10");

    expect(mockStartTimer).toHaveBeenCalledTimes(1);
    expect(mockObserveDuration).toHaveBeenCalledTimes(1);
    expect(mockStartTimer).toHaveBeenCalledWith({ period: "all", sort_by: "total_donated_xlm" });
  });

  test("records the duration even when the query fails, and caches nothing", async () => {
    const pool = require("../db/pool");
    pool.query.mockRejectedValueOnce(new Error("deadlock detected"));

    const res = await request(app).get("/api/leaderboard?limit=10");

    expect(res.status).toBe(500);
    expect(mockObserveDuration).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
