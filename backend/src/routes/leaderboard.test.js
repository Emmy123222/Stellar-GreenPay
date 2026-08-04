/**
 * src/routes/leaderboard.test.js
 * Unit tests for the leaderboard route SQL query structure.
 *
 * Verifies that the dynamically-built SQL query is syntactically valid for
 * every combination of `period` and `onlyVerified` parameters (issue #661),
 * that ranking is assigned correctly, and that the monthly leaderboard
 * history endpoint (issue #758) groups and paginates correctly.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const { createRateLimiter } = require("../middleware/rateLimiter");

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
  createRateLimiter: jest.fn(() => (_req, _res, next) => next()),
}));

const pool = require("../db/pool");
const leaderboardRouter = require("./leaderboard");

// leaderboard.js calls createRateLimiter(30, 1) exactly once, at module load
// time (`const leaderboardLimiter = createRateLimiter(30, 1);`). That call
// already happened on the `require` above. jest.clearAllMocks() in later
// beforeEach hooks wipes createRateLimiter.mock.calls, so we snapshot the
// call args here, before any clearAllMocks runs, and assert against the
// snapshot instead of the live mock history.
const rateLimiterInitCall = createRateLimiter.mock.calls[0];

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
  // mockClear() only wipes call history — it does NOT restore an
  // implementation overridden by mockResolvedValue()/mockResolvedValueOnce()
  // in a previous test. Re-installing the recording implementation here
  // guarantees every test starts from the same clean state regardless of
  // what a prior test did to the mock.
  pool.query.mockReset().mockImplementation((sql) => {
    queries.push({ sql });
    return { rows: [] };
  });
}

// Rows are already in DESC order by total_donated_xlm, simulating what the
// DB query returns. NOTE: `rank` is NOT a DB column for this endpoint — the
// route computes it client-side as `index + 1` after sorting, so mock rows
// intentionally omit it.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/leaderboard — ranking assignment", () => {
  beforeEach(resetQueries);

  test("assigns rank 1 to the highest donor and increments for each subsequent entry", async () => {
    pool.query.mockResolvedValue({ rows: SORTED_DONORS });

    const app = createApp();
    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);

    // Rank is computed positionally (index + 1), not read from the DB.
    res.body.data.forEach((entry, i) => {
      expect(entry.rank).toBe(i + 1);
    });
  });
});

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
    expect(sql).toMatch(/NOT EXISTS\s*\(/i);
    expect(sql).toMatch(/EXISTS\s*\(/i);
    const joinIndex = sql.lastIndexOf("JOIN");
    const whereIndex = sql.lastIndexOf("WHERE");
    expect(whereIndex).toBeGreaterThan(joinIndex);
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
    const joinIndex = sql.lastIndexOf("JOIN");
    const whereIndex = sql.lastIndexOf("WHERE");
    expect(whereIndex).toBeGreaterThan(joinIndex);
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

  test("SQL matches snapshot for period=month & onlyVerified=true", async () => {
    const app = createApp();
    await request(app).get("/api/leaderboard?period=month&onlyVerified=true");

    const sql = queries[0].sql;
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

describe("GET /api/leaderboard/history", () => {
  beforeEach(resetQueries);

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

    const app = createApp();
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

    const app = createApp();
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

    const app = createApp();
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

    const app = createApp();
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

    const app = createApp();
    const res = await request(app).get("/api/leaderboard/history").expect(200);

    expect(res.body.data[0].entries[0].displayName).toBeNull();
    expect(res.body.data[0].entries[0].badge).toBeNull();
  });

  test("returns empty array when no monthly leaderboard data exists", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const app = createApp();
    const res = await request(app).get("/api/leaderboard/history").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  test("caps months parameter at 24 when larger value is requested", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const app = createApp();
    await request(app).get("/api/leaderboard/history?months=50").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [24]);
  });

  test("uses default of 12 months when not specified", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const app = createApp();
    await request(app).get("/api/leaderboard/history").expect(200);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [12]);
  });
});

describe("GET /api/leaderboard — rate limiting (issue #695)", () => {
  test("createRateLimiter is called with (30, 1) — 30 req/min per IP", () => {
    // See the module-load-time comment near the top of this file: this
    // checks the snapshot taken immediately after require(), since later
    // beforeEach hooks call jest.clearAllMocks() and would otherwise erase
    // the one-time call record.
    expect(rateLimiterInitCall).toEqual([30, 1]);
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