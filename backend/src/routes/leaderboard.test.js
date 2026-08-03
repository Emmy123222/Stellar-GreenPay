/**
 * src/routes/leaderboard.test.js
 * Unit tests for the leaderboard route SQL query structure.
 *
 * Verifies that the dynamically-built SQL query is syntactically valid for
 * every combination of `period` and `onlyVerified` parameters (issue #661).
 */
"use strict";

const express = require("express");
const request = require("supertest");

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Track every query that gets passed to pool.query(). */
const queries = [];

jest.mock("../db/pool", () => ({
  query: jest.fn().mockImplementation((sql) => {
    queries.push({ sql });
    return { rows: [] };
  }),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

// Mock the rate limiter so it is transparent for all existing tests.
// Individual tests that need to verify rate-limit behaviour re-require
// the router with a blocking mock.
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: jest.fn(() => (_req, _res, next) => next()),
}));

const pool = require("../db/pool");
const leaderboardRouter = require("./leaderboard");

// ---------------------------------------------------------------------------
// Express app factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = express();
  app.use("/api/leaderboard", leaderboardRouter);
  // Catch-all error handler so errors don't crash tests
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, error: err.message });
  });
  return app;
}

function resetQueries() {
  queries.length = 0;
  pool.query.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("leaderboard route SQL structure", () => {
  beforeEach(resetQueries);

  // -----------------------------------------------------------------------
  // Basic valid structure
  // -----------------------------------------------------------------------

  test("produces valid SQL with default params (period=all, onlyVerified=false)", async () => {
    const app = createApp();
    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(queries.length).toBe(1);
    const sql = queries[0].sql;

    // Must contain the core SELECT
    expect(sql).toMatch(/SELECT\s+p\.public_key/);
    // Must have all JOINs before any WHERE
    const fromIndex = sql.indexOf("FROM");
    const whereIndex = sql.indexOf("WHERE");
    const groupByIndex = sql.indexOf("GROUP BY");
    const limitIndex = sql.indexOf("LIMIT");

    expect(fromIndex).toBeGreaterThan(0);
    expect(groupByIndex).toBeGreaterThan(fromIndex);
    expect(limitIndex).toBeGreaterThan(groupByIndex);

    // Without period or onlyVerified, there should be no WHERE clause
    expect(whereIndex).toBe(-1);
    expect(res.body.success).toBe(true);
  });

  test("contains LEFT JOIN projects before GROUP BY", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard");

    const sql = queries[0].sql;
    const joinIndex = sql.indexOf("LEFT JOIN projects");
    const groupByIndex = sql.indexOf("GROUP BY");
    expect(joinIndex).toBeGreaterThan(0);
    expect(groupByIndex).toBeGreaterThan(joinIndex);
  });

  // -----------------------------------------------------------------------
  // Period filter
  // -----------------------------------------------------------------------

  test("produces valid SQL with period=month", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?period=month");

    const sql = queries[0].sql;
    expect(sql).toMatch(/WHERE\s+.*d\.created_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL\s+'30 days'/i);
    // WHERE must come after JOINs and before GROUP BY
    const joinIndex = sql.lastIndexOf("JOIN");
    const whereIndex = sql.indexOf("WHERE");
    const groupByIndex = sql.indexOf("GROUP BY");
    expect(whereIndex).toBeGreaterThan(joinIndex);
    expect(groupByIndex).toBeGreaterThan(whereIndex);
  });

  test("produces valid SQL with period=year", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?period=year");

    const sql = queries[0].sql;
    expect(sql).toMatch(/WHERE\s+.*d\.created_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL\s+'1 year'/i);
    const joinIndex = sql.lastIndexOf("JOIN");
    const whereIndex = sql.indexOf("WHERE");
    const groupByIndex = sql.indexOf("GROUP BY");
    expect(whereIndex).toBeGreaterThan(joinIndex);
    expect(groupByIndex).toBeGreaterThan(whereIndex);
  });

  // -----------------------------------------------------------------------
  // onlyVerified filter
  // -----------------------------------------------------------------------

  test("produces valid SQL with onlyVerified=true", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?onlyVerified=true");

    const sql = queries[0].sql;
    expect(sql).toMatch(/WHERE/);
    // Must have NOT EXISTS and EXISTS subqueries
    expect(sql).toMatch(/NOT EXISTS\s*\(/i);
    expect(sql).toMatch(/EXISTS\s*\(/i);
    // Use lastIndexOf for WHERE because subqueries contain their own WHERE
    // clauses that appear before the top-level WHERE.
    const joinIndex = sql.lastIndexOf("JOIN");
    const whereIndex = sql.lastIndexOf("WHERE");
    expect(whereIndex).toBeGreaterThan(joinIndex);
    // GROUP BY must be after WHERE
    const groupByIndex = sql.indexOf("GROUP BY");
    expect(groupByIndex).toBeGreaterThan(whereIndex);
  });

  // -----------------------------------------------------------------------
  // Combined filters
  // -----------------------------------------------------------------------

  test("produces valid SQL with period=month and onlyVerified=true", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?period=month&onlyVerified=true");

    const sql = queries[0].sql;
    expect(sql).toMatch(/WHERE/);
    expect(sql).toMatch(/d\.created_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL/i);
    expect(sql).toMatch(/NOT EXISTS\s*\(/i);
    expect(sql).toMatch(/EXISTS\s*\(/i);
    // WHERE must be after all JOINs (lastIndexOf to skip subquery WHEREs)
    const joinIndex = sql.lastIndexOf("JOIN");
    const whereIndex = sql.lastIndexOf("WHERE");
    expect(whereIndex).toBeGreaterThan(joinIndex);
    // GROUP BY after WHERE
    const groupByIndex = sql.indexOf("GROUP BY");
    expect(groupByIndex).toBeGreaterThan(whereIndex);
  });

  test("produces valid SQL with period=year and onlyVerified=true", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?period=year&onlyVerified=true");

    const sql = queries[0].sql;
    expect(sql).toMatch(/WHERE/);
    expect(sql).toMatch(/d\.created_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL/i);
    expect(sql).toMatch(/NOT EXISTS\s*\(/i);
    expect(sql).toMatch(/EXISTS\s*\(/i);
    const joinIndex = sql.lastIndexOf("JOIN");
    const whereIndex = sql.lastIndexOf("WHERE");
    expect(whereIndex).toBeGreaterThan(joinIndex);
  });

  // -----------------------------------------------------------------------
  // ORDER BY / sortBy
  // -----------------------------------------------------------------------

  test("defaults to ordering by total_donated_xlm", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard");

    expect(queries[0].sql).toMatch(/ORDER BY\s+total_donated_xlm\s+DESC/i);
  });

  test("orders by impact_score when sortBy=impactScore", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?sortBy=impactScore");

    expect(queries[0].sql).toMatch(/ORDER BY\s+impact_score\s+DESC/i);
  });

  // -----------------------------------------------------------------------
  // LIMIT
  // -----------------------------------------------------------------------

  test("respects limit parameter", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?limit=10");

    expect(queries[0].sql).toMatch(/LIMIT\s+\$1/i);
    // Verify pool.query was called with the correct params
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([10]),
    );
  });

  // -----------------------------------------------------------------------
  // SQL structure snapshot tests (catch regressions in query construction)
  // -----------------------------------------------------------------------

  test("SQL matches snapshot for period=month", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?period=month");

    const sql = queries[0].sql;
    // Verify the structure: FROM → JOIN → JOIN → WHERE → GROUP BY → ORDER BY → LIMIT
    const structure = [
      sql.indexOf("FROM"),
      sql.indexOf("LEFT JOIN donations"),
      sql.indexOf("LEFT JOIN projects"),
      sql.indexOf("WHERE"),
      sql.indexOf("GROUP BY"),
      sql.indexOf("ORDER BY"),
      sql.indexOf("LIMIT"),
    ];
    // All indices should be in ascending order
    for (let i = 1; i < structure.length; i++) {
      expect(structure[i]).toBeGreaterThan(structure[i - 1]);
    }
  });

  test("SQL matches snapshot for period=month & onlyVerified=true", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?period=month&onlyVerified=true");

    const sql = queries[0].sql;
    // Verify the structure: FROM → JOIN → JOIN → WHERE → GROUP BY → ORDER BY → LIMIT
    const structure = [
      sql.indexOf("FROM"),
      sql.indexOf("LEFT JOIN donations"),
      sql.indexOf("LEFT JOIN projects"),
      sql.indexOf("WHERE"),
      sql.indexOf("GROUP BY"),
      sql.indexOf("ORDER BY"),
      sql.indexOf("LIMIT"),
    ];
    for (let i = 1; i < structure.length; i++) {
      expect(structure[i]).toBeGreaterThan(structure[i - 1]);
    }
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  test("returns 200 with empty data when no rows match", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
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
