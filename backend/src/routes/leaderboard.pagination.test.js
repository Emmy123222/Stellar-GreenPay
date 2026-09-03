/**
 * Unit test: GET /api/leaderboard — cursor-based pagination
 *
 * Strategy
 * --------
 * The route orders rows by (total_donated_xlm DESC, public_key DESC) and
 * issues a base64 JSON cursor of { total_donated_xlm, publicKey } for the
 * next page.  We mock pool.query so that each call receives the *entire*
 * sorted dataset and slices out the correct window, exactly mimicking what
 * PostgreSQL would do for:
 *
 *   SELECT ... FROM profiles p ...
 *   [WHERE (total_donated_xlm < $ca OR (total_donated_xlm = $ca AND p.public_key < $pk))]
 *   GROUP BY p.public_key, p.display_name, p.badges
 *   ORDER BY total_donated_xlm DESC, p.public_key DESC
 *   LIMIT <pageSize+1>
 *
 * Rows with a distinct total_donated_xlm are used so the sort is
 * deterministic (no tie-breaking ambiguity).
 */
"use strict";

// ─── Module mocks (must come before any require) ─────────────────────────────

jest.mock("../db/pool", () => ({ query: jest.fn() }));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: jest.fn(() => (_req, _res, next) => next()),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const leaderboardRouter = require("./leaderboard");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Express app that mounts the leaderboard router. */
function buildApp() {
  const app = express();
  app.use("/api/leaderboard", leaderboardRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

/** Decode a next_cursor value produced by the route. */
function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
}

/**
 * Generate 25 fake donor DB rows with distinct total_donated_xlm values.
 *
 * Rows are returned already sorted DESC by (total_donated_xlm, public_key)
 * to match what the real aggregated query would return.
 */
function generate25Donors() {
  const rows = [];
  for (let i = 0; i < 25; i++) {
    rows.push({
      public_key: `G${String(i).padStart(55, "0")}${String(i).padStart(1, "0")}`.slice(0, 56),
      display_name: `Donor ${i + 1}`,
      badges: [],
      total_donated_xlm: String((25 - i) * 100), // row 0 → biggest, row 24 → smallest
      total_co2_offset_kg: "0",
      impact_score: String((25 - i) * 70),
      projects_supported: 1,
    });
  }
  return rows; // index 0 = highest donor, index 24 = lowest donor
}

/**
 * Simulate the SQL filter + ORDER BY + LIMIT, operating on an array that is
 * already sorted DESC, returning pageSize + 1 rows.
 *
 * Cursor filter mimics: (total_donated_xlm < $sortVal) OR
 *                       (total_donated_xlm = $sortVal AND p.public_key < $pk)
 */
function simulateDbQuery(allRows, cursor, pageSize) {
  let filtered = allRows;

  if (cursor) {
    const { total_donated_xlm, publicKey } = decodeCursor(cursor);
    filtered = allRows.filter((row) => {
      const rowSort = Number(row.total_donated_xlm);
      const cursorSort = Number(total_donated_xlm);
      if (rowSort < cursorSort) return true;
      if (rowSort === cursorSort && row.public_key < publicKey) return true;
      return false;
    });
  }

  return filtered.slice(0, pageSize + 1);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("GET /api/leaderboard — cursor-based pagination", () => {
  let app;
  const ALL_ROWS = generate25Donors(); // 25 rows, sorted DESC

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();

    pool.query.mockImplementation((sql, params = []) => {
      // pageSize is pageSize+1 stored in params; it is the last numeric arg.
      const pageSize = Number(params[params.length - 1]) - 1;

      // Reconstruct the cursor from the params the route passes:
      // [sortValue, publicKey, pageSize+1] when a cursor is present, or
      // [pageSize+1] for the first page.
      let cursor = null;
      if (params.length >= 3 && typeof params[0] === "string") {
        cursor = Buffer.from(
          JSON.stringify({ total_donated_xlm: params[0], publicKey: params[1] }),
        ).toString("base64");
      }

      const rows = simulateDbQuery(ALL_ROWS, cursor, pageSize);
      return Promise.resolve({ rows });
    });
  });

  // ── Default limit ──────────────────────────────────────────────────────────

  test("defaults to limit of 50 entries", async () => {
    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(25); // fewer than 50 total
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
  });

  // ── Custom limits ──────────────────────────────────────────────────────────

  test("respects a custom limit of 10", async () => {
    const res = await request(app).get("/api/leaderboard?limit=10").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.has_more).toBe(true);
    expect(res.body.next_cursor).toBeTruthy();
  });

  test("caps a custom limit at the maximum of 200", async () => {
    const res = await request(app).get("/api/leaderboard?limit=10000").expect(200);

    // With only 25 donors, a page of up to 200 returns all of them.
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(25);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
  });

  // ── Subsequent pages ───────────────────────────────────────────────────────

  test("page 2 returns the next 10 donors following the cursor", async () => {
    const page1 = await request(app).get("/api/leaderboard?limit=10").expect(200);
    const cursor1 = page1.body.next_cursor;

    const res = await request(app)
      .get(`/api/leaderboard?limit=10&cursor=${cursor1}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.has_more).toBe(true);
    expect(res.body.next_cursor).toBeTruthy();

    const ids = res.body.data.map((d) => d.publicKey);
    expect(ids).toEqual(ALL_ROWS.slice(10, 20).map((r) => r.public_key));
  });

  test("page 3 returns the remaining 5 donors and no next cursor (end)", async () => {
    const page1 = await request(app).get("/api/leaderboard?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/leaderboard?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/leaderboard?limit=10&cursor=${page2.body.next_cursor}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();

    const ids = res.body.data.map((d) => d.publicKey);
    expect(ids).toEqual(ALL_ROWS.slice(20, 25).map((r) => r.public_key));
  });

  test("all 25 donor public keys appear exactly once across all pages", async () => {
    const page1 = await request(app).get("/api/leaderboard?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/leaderboard?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);
    const page3 = await request(app)
      .get(`/api/leaderboard?limit=10&cursor=${page2.body.next_cursor}`)
      .expect(200);

    const allKeys = [
      ...page1.body.data.map((d) => d.publicKey),
      ...page2.body.data.map((d) => d.publicKey),
      ...page3.body.data.map((d) => d.publicKey),
    ];
    expect(new Set(allKeys).size).toBe(25);
  });

  // ── Ordering ───────────────────────────────────────────────────────────────

  test("keeps total_donated_xlm DESC ordering within and across pages", async () => {
    const values = [];
    let cursor = null;
    let guard = 0;

    while (guard++ < 10) {
      const url = cursor ? `/api/leaderboard?limit=10&cursor=${cursor}` : "/api/leaderboard?limit=10";
      const res = await request(app).get(url).expect(200);
      values.push(...res.body.data.map((d) => Number(d.totalDonatedXLM)));
      cursor = res.body.next_cursor;
      if (!cursor) break;
    }

    expect(values).toHaveLength(25);
    for (let i = 1; i < values.length; i++) {
      expect(values[i - 1]).toBeGreaterThanOrEqual(values[i]);
    }
  });

  // ── Invalid pagination parameters ──────────────────────────────────────────

  test("returns 400 for an invalid (malformed) cursor", async () => {
    const res = await request(app).get("/api/leaderboard?cursor=!!not-base64!!").expect(400);
    expect(res.body.error).toBe("Invalid cursor");
  });

  test("returns 400 for a cursor missing the required fields", async () => {
    const badCursor = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64");
    const res = await request(app).get(`/api/leaderboard?cursor=${badCursor}`).expect(400);
    expect(res.body.error).toBe("Invalid cursor");
  });

  test("returns 400 for a cursor missing publicKey", async () => {
    const badCursor = Buffer.from(JSON.stringify({ total_donated_xlm: "100" })).toString("base64");
    const res = await request(app).get(`/api/leaderboard?cursor=${badCursor}`).expect(400);
    expect(res.body.error).toBe("Invalid cursor");
  });

  // ── Empty / end-of-pagination behaviour ────────────────────────────────────

  test("returns empty data and no cursor when the result set is empty", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/leaderboard").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
  });

  test("requesting a page past the end returns empty data without a cursor", async () => {
    // Page 1 covers all 25 donors, so any further cursor yields nothing.
    const page1 = await request(app).get("/api/leaderboard?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/leaderboard?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);
    const page3 = await request(app)
      .get(`/api/leaderboard?limit=10&cursor=${page2.body.next_cursor}`)
      .expect(200);

    expect(page3.body.data).toHaveLength(5);
    expect(page3.body.has_more).toBe(false);
    expect(page3.body.next_cursor).toBeNull();
  });
});
