/**
 * Integration test: GET /api/projects — cursor-based pagination
 *
 * Strategy
 * --------
 * The route orders rows by (created_at DESC, id DESC) and issues a base64
 * JSON cursor of { created_at, id } for the next page.  We mock pool.query
 * so that each call receives the *entire* sorted dataset and slices out the
 * correct window, exactly mimicking what PostgreSQL would do for:
 *
 *   SELECT * FROM projects
 *   [WHERE (created_at < $ca OR (created_at = $ca AND id < $id))]
 *   ORDER BY created_at DESC, id DESC
 *   LIMIT <pageSize+1>
 */
"use strict";

// ─── Module mocks (must come before any require) ─────────────────────────────

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));

jest.mock("../services/redis", () => ({
  get: jest.fn().mockResolvedValue(null), // always cache-miss so we exercise the DB path
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
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

/**
 * Generate 25 fake project DB rows.
 *
 * Each row gets a *distinct* created_at timestamp spaced 1 second apart so
 * that the ORDER BY created_at DESC, id DESC sort is deterministic — no two
 * rows share the same timestamp, which avoids tie-breaking ambiguity.
 *
 * The rows are returned already sorted DESC (newest first) to match what the
 * real DB query would return.
 */
function generate25Projects() {
  const base = new Date("2026-01-25T12:00:00.000Z").getTime();
  const rows = [];

  for (let i = 0; i < 25; i++) {
    // row 0 → newest, row 24 → oldest  (DESC order)
    const created_at = new Date(base - i * 1000).toISOString();
    rows.push({
      id: `proj-${String(i + 1).padStart(3, "0")}`,
      name: `Climate Project ${i + 1}`,
      description: `Description for climate project number ${i + 1} — long enough to pass validation`,
      category: "Reforestation",
      location: "Earth",
      wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      goal_xlm: "10000",
      raised_xlm: "0",
      donor_count: 0,
      co2_offset_kg: 0,
      status: "active",
      verified: true,
      on_chain_verified: false,
      tags: ["test"],
      created_at,
      updated_at: created_at,
    });
  }

  return rows; // index 0 = newest, index 24 = oldest
}

/**
 * Decode a next_cursor value produced by the route into { created_at, id }.
 */
function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
}

/**
 * Simulate the SQL filter + ORDER BY + LIMIT that the route builds, operating
 * on an in-memory array that is already sorted DESC.
 *
 * The route fetches (pageSize + 1) rows so it can detect whether there is a
 * next page; our mock does the same.
 */
function simulateDbQuery(allRows, cursor, pageSize) {
  let filtered = allRows;

  if (cursor) {
    const { created_at: cursorCa, id: cursorId } = decodeCursor(cursor);
    filtered = allRows.filter((row) => {
      // Mimic: (created_at < $ca) OR (created_at = $ca AND id < $id)
      if (row.created_at < cursorCa) return true;
      if (row.created_at === cursorCa && row.id < cursorId) return true;
      return false;
    });
  }

  // Already sorted DESC by design; slice out pageSize + 1 rows.
  return filtered.slice(0, pageSize + 1);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("GET /api/projects — cursor-based pagination across 3 pages", () => {
  let app;
  const ALL_ROWS = generate25Projects(); // 25 rows, sorted DESC

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();

    // Always cache-miss so every request hits pool.query.
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue("OK");

    /**
     * pool.query mock — intercepts every call the route makes and applies the
     * same cursor-filtering logic as the real SQL query would.
     *
     * The route passes parameters as positional $N values.  We inspect the
     * query string for "LIMIT" and extract the cursor from the values array
     * by checking whether any value looks like a base64 cursor JSON.
     *
     * Simpler approach: capture the cursor from query string inspection.
     * We capture the raw cursor by inspecting the SQL and params directly.
     */
    pool.query.mockImplementation((sql, params = []) => {
      // Identify pageSize from the params — it is always the last numeric arg.
      const pageSize = Number(params[params.length - 1]) - 1;

      // Try to reconstruct the cursor: the route pushes created_at and id
      // onto `values` just before the LIMIT param when a cursor is present.
      // That means params looks like: [...filterValues, created_at, id, pageSize+1]
      let cursor = null;
      if (params.length >= 3) {
        // created_at is second-to-last before LIMIT, id is right before LIMIT
        const possibleCa = params[params.length - 3];
        const possibleId = params[params.length - 2];
        if (
          typeof possibleCa === "string" &&
          /^\d{4}-\d{2}-\d{2}T/.test(possibleCa) &&
          typeof possibleId === "string"
        ) {
          // Reconstruct cursor the same way the route does
          cursor = Buffer.from(JSON.stringify({ created_at: possibleCa, id: possibleId })).toString("base64");
        }
      }

      const rows = simulateDbQuery(ALL_ROWS, cursor, pageSize);
      return Promise.resolve({ rows });
    });
  });

  // ── Page 1 ────────────────────────────────────────────────────────────────

  test("page 1 returns exactly 10 projects and a next_cursor", async () => {
    const res = await request(app).get("/api/projects?limit=10").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.has_more).toBe(true);
    expect(res.body.next_cursor).toBeTruthy();
  });

  test("page 1 contains the 10 newest projects (proj-001 through proj-010)", async () => {
    const res = await request(app).get("/api/projects?limit=10").expect(200);

    const ids = res.body.data.map((p) => p.id);
    expect(ids).toEqual([
      "proj-001", "proj-002", "proj-003", "proj-004", "proj-005",
      "proj-006", "proj-007", "proj-008", "proj-009", "proj-010",
    ]);
  });

  // ── Page 2 ────────────────────────────────────────────────────────────────

  test("page 2 returns exactly 10 projects and a next_cursor", async () => {
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);
    const cursor1 = page1.body.next_cursor;

    const res = await request(app)
      .get(`/api/projects?limit=10&cursor=${cursor1}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.has_more).toBe(true);
    expect(res.body.next_cursor).toBeTruthy();
  });

  test("page 2 contains the next 10 projects (proj-011 through proj-020)", async () => {
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);

    const res = await request(app)
      .get(`/api/projects?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);

    const ids = res.body.data.map((p) => p.id);
    expect(ids).toEqual([
      "proj-011", "proj-012", "proj-013", "proj-014", "proj-015",
      "proj-016", "proj-017", "proj-018", "proj-019", "proj-020",
    ]);
  });

  // ── Page 3 ────────────────────────────────────────────────────────────────

  test("page 3 returns exactly 5 projects and no next_cursor (last page)", async () => {
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/projects?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/projects?limit=10&cursor=${page2.body.next_cursor}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
  });

  test("page 3 contains the final 5 projects (proj-021 through proj-025)", async () => {
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/projects?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/projects?limit=10&cursor=${page2.body.next_cursor}`)
      .expect(200);

    const ids = res.body.data.map((p) => p.id);
    expect(ids).toEqual([
      "proj-021", "proj-022", "proj-023", "proj-024", "proj-025",
    ]);
  });

  // ── Cross-page completeness ────────────────────────────────────────────────

  test("all 25 project IDs appear exactly once across all 3 pages", async () => {
    // Fetch all three pages sequentially, following cursors.
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/projects?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);
    const page3 = await request(app)
      .get(`/api/projects?limit=10&cursor=${page2.body.next_cursor}`)
      .expect(200);

    const allIds = [
      ...page1.body.data.map((p) => p.id),
      ...page2.body.data.map((p) => p.id),
      ...page3.body.data.map((p) => p.id),
    ];

    // Total count must be exactly 25.
    expect(allIds).toHaveLength(25);

    // Every expected ID is present…
    const expectedIds = ALL_ROWS.map((r) => r.id);
    for (const id of expectedIds) {
      expect(allIds).toContain(id);
    }

    // …and each appears exactly once (no duplicates, no omissions).
    const idCounts = allIds.reduce((acc, id) => {
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});

    for (const id of expectedIds) {
      expect(idCounts[id]).toBe(1);
    }

    // Unique set size must equal 25.
    expect(new Set(allIds).size).toBe(25);
  });

  // ── Cursor integrity ──────────────────────────────────────────────────────

  test("next_cursor on page 1 encodes the created_at and id of the 10th project", async () => {
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);
    const cursorPayload = decodeCursor(page1.body.next_cursor);

    // The 10th project in DESC order is proj-010.
    const expectedRow = ALL_ROWS[9]; // index 9 = proj-010
    expect(cursorPayload.created_at).toBe(expectedRow.created_at);
    expect(cursorPayload.id).toBe(expectedRow.id);
  });

  test("next_cursor on page 2 encodes the created_at and id of the 20th project", async () => {
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/projects?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);

    const cursorPayload = decodeCursor(page2.body.next_cursor);

    // The 20th project in DESC order is proj-020.
    const expectedRow = ALL_ROWS[19]; // index 19 = proj-020
    expect(cursorPayload.created_at).toBe(expectedRow.created_at);
    expect(cursorPayload.id).toBe(expectedRow.id);
  });

  // ── No duplicate pages ────────────────────────────────────────────────────

  test("no ID appears on more than one page", async () => {
    const page1 = await request(app).get("/api/projects?limit=10").expect(200);
    const page2 = await request(app)
      .get(`/api/projects?limit=10&cursor=${page1.body.next_cursor}`)
      .expect(200);
    const page3 = await request(app)
      .get(`/api/projects?limit=10&cursor=${page2.body.next_cursor}`)
      .expect(200);

    const ids1 = new Set(page1.body.data.map((p) => p.id));
    const ids2 = new Set(page2.body.data.map((p) => p.id));
    const ids3 = new Set(page3.body.data.map((p) => p.id));

    // Intersections must be empty.
    const overlap12 = [...ids1].filter((id) => ids2.has(id));
    const overlap13 = [...ids1].filter((id) => ids3.has(id));
    const overlap23 = [...ids2].filter((id) => ids3.has(id));

    expect(overlap12).toHaveLength(0);
    expect(overlap13).toHaveLength(0);
    expect(overlap23).toHaveLength(0);
  });
});
