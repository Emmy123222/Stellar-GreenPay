"use strict";

jest.mock("../db/pool", () => ({
  query:   jest.fn(),
  connect: jest.fn(),
}));

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

describe("POST /api/leaderboard/snapshot — idempotent upsert", () => {
  let app;
  const ADMIN_SECRET_SAVE = process.env.ADMIN_SECRET;

  beforeAll(() => {
    process.env.ADMIN_SECRET = "test-admin-secret";
  });

  afterAll(() => {
    process.env.ADMIN_SECRET = ADMIN_SECRET_SAVE;
  });

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  const MOCK_TOP_DONORS = [
    {
      public_key: "GA1",
      display_name: "Alice",
      badges: [{ tier: "earth" }],
      total_xlm: "5000",
    },
    {
      public_key: "GB2",
      display_name: "Bob",
      badges: [],
      total_xlm: "750",
    },
  ];

  function makeMockClient() {
    return {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
  }

  test("returns 403 without the x-admin-secret header", async () => {
    const res = await request(app)
      .post("/api/leaderboard/snapshot")
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Forbidden");
  });

  test("returns 403 with a wrong admin secret", async () => {
    const res = await request(app)
      .post("/api/leaderboard/snapshot")
      .set("x-admin-secret", "wrong-secret")
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Forbidden");
  });

  test("responds with message when there are no donations this month", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/leaderboard/snapshot")
      .set("x-admin-secret", "test-admin-secret")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("No donations this month yet");
    expect(res.body.inserted).toBe(0);
    // Should not attempt a transaction when there are no rows
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test("calling snapshot twice for the same month is idempotent", async () => {
    const mockClient = makeMockClient();

    // --- First call ---
    pool.query.mockResolvedValueOnce({ rows: MOCK_TOP_DONORS });
    pool.connect.mockResolvedValueOnce(mockClient);

    const res1 = await request(app)
      .post("/api/leaderboard/snapshot")
      .set("x-admin-secret", "test-admin-secret")
      .expect(200);

    expect(res1.body.success).toBe(true);
    expect(res1.body.inserted).toBe(2);
    expect(res1.body.month).toEqual(expect.stringMatching(/^\d{4}-\d{2}-01$/));

    // Verify the INSERT statements use ON CONFLICT
    const insertCalls = mockClient.query.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.startsWith("INSERT")
    );
    expect(insertCalls.length).toBe(2);
    insertCalls.forEach(([sql]) => {
      expect(sql).toContain("ON CONFLICT");
    });

    // Verify transaction was opened and committed
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalled();

    // --- Second call (same month, ON CONFLICT will update existing rows) ---
    jest.clearAllMocks();
    const mockClient2 = makeMockClient();

    pool.query.mockResolvedValueOnce({ rows: MOCK_TOP_DONORS });
    pool.connect.mockResolvedValueOnce(mockClient2);

    const res2 = await request(app)
      .post("/api/leaderboard/snapshot")
      .set("x-admin-secret", "test-admin-secret")
      .expect(200);

    expect(res2.body.success).toBe(true);
    // Must return the same inserted count both times
    expect(res2.body.inserted).toBe(res1.body.inserted);
    expect(res2.body.month).toBe(res1.body.month);

    // Verify INSERTs still use ON CONFLICT
    const insertCalls2 = mockClient2.query.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.startsWith("INSERT")
    );
    expect(insertCalls2.length).toBe(2);
    insertCalls2.forEach(([sql]) => {
      expect(sql).toContain("ON CONFLICT");
    });
  });

  test("snapshot respects limit query parameter (max 500)", async () => {
    const mockClient = makeMockClient();

    // Supply a mock that honours the LIMIT param: 3 donors in DB, but
    // request says limit=2, so only 2 rows come back from pool.query.
    const threeDonors = [
      ...MOCK_TOP_DONORS,
      {
        public_key: "GC3",
        display_name: "Charlie",
        badges: [{ tier: "forest" }],
        total_xlm: "100",
      },
    ];

    pool.query.mockImplementationOnce((_sql, params) => {
      const limit = params?.[0] ?? 100;
      return Promise.resolve({ rows: threeDonors.slice(0, limit) });
    });
    pool.connect.mockResolvedValueOnce(mockClient);

    const res = await request(app)
      .post("/api/leaderboard/snapshot?limit=2")
      .set("x-admin-secret", "test-admin-secret")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.inserted).toBe(2);

    // Only 2 INSERTs were executed
    const insertCalls = mockClient.query.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.startsWith("INSERT")
    );
    expect(insertCalls.length).toBe(2);
  });
});
