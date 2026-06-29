"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../services/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
}));

jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn(),
  CONTRACT_ID: "test-contract",
  server: {},
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

jest.mock("../services/summaryQueue", () => ({
  enqueueAISummary: jest.fn(),
}));

const pool = require("../db/pool");
const redis = require("../services/redis");
const express = require("express");
const request = require("supertest");
const projectsRouter = require("./projects");

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

const MOCK_PROJECT_ROW = {
  id: "proj-1",
  name: "Test Project",
  description: "A test climate project",
  category: "Reforestation",
  location: "Brazil",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  goal_xlm: "10000",
  raised_xlm: "5000",
  donor_count: 42,
  co2_offset_kg: 50000,
  status: "active",
  verified: true,
  on_chain_verified: false,
  tags: ["reforestation", "amazon"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("GET /api/projects", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    redis.get.mockResolvedValue(null);
    jest.clearAllMocks();
  });

  test("returns projects list with default pagination", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });

    const res = await request(app).get("/api/projects").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Test Project");
    expect(res.body.has_more).toBe(false);
  });

  test("filters by category", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });

    await request(app).get("/api/projects?category=Reforestation").expect(200);

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("category =");
  });

  test("filters by verified status", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });

    await request(app).get("/api/projects?verified=true").expect(200);

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("verified = true");
  });

  test("filters by status", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });

    await request(app).get("/api/projects?status=active").expect(200);

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("status =");
  });

  test("handles search query", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });

    await request(app).get("/api/projects?search=amazon").expect(200);

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("ILIKE");
  });

  test("rejects invalid cursor", async () => {
    await request(app).get("/api/projects?cursor=invalid").expect(400);
  });

  test("returns cached response when available", async () => {
    const cached = { success: true, data: [MOCK_PROJECT_ROW], has_more: false };
    redis.get.mockResolvedValue(cached);

    const res = await request(app).get("/api/projects").expect(200);
    expect(res.body).toEqual(cached);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("respects limit parameter", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });

    await request(app).get("/api/projects?limit=5").expect(200);

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("LIMIT");
  });
});

describe("GET /api/projects/featured", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("cold cache queries DB and warm cache reuses cached result", async () => {
    const dbSpy = jest.spyOn(pool, "query");
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });

    const cold = await request(app).get("/api/projects/featured").expect(200);
    expect(cold.body.success).toBe(true);
    expect(cold.body.data.id).toBe("proj-1");
    expect(dbSpy).toHaveBeenCalledTimes(1);

    const warm = await request(app).get("/api/projects/featured").expect(200);
    expect(warm.body.success).toBe(true);
    expect(warm.body.data.id).toBe("proj-1");
    expect(dbSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  test("after cache expiry queries DB again", async () => {
    const dbSpy = jest.spyOn(pool, "query");
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(9_999_999_999_000);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] });

    await request(app).get("/api/projects/featured").expect(200);
    expect(dbSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(9_999_999_999_000 + 24 * 60 * 60 * 1000 + 1);
    const refreshedRow = {
      ...MOCK_PROJECT_ROW,
      id: "proj-2",
      name: "Refreshed Project",
    };
    pool.query.mockResolvedValueOnce({ rows: [refreshedRow] });

    const res = await request(app).get("/api/projects/featured").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("proj-2");
    expect(dbSpy).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  test("returns 404 when there are no active projects", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(99_999_999_999_999);
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/projects/featured").expect(404);
    expect(res.body).toEqual({ error: "No featured project found" });

    nowSpy.mockRestore();
  });
});

describe("GET /api/projects/:id", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    redis.get.mockResolvedValue(null);
    jest.clearAllMocks();
  });

  test("returns a single project", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] });
    pool.query.mockResolvedValueOnce({ rows: [] }); // campaigns
    pool.query.mockResolvedValueOnce({ rows: [] }); // milestones
    pool.query.mockResolvedValueOnce({ rows: [] }); // ratings

    const res = await request(app).get("/api/projects/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Test Project");
  });

  test("returns 404 for non-existent project", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/projects/nonexistent").expect(404);
  });
});

describe("POST /api/projects (admin)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/projects/admin/register")
      .send({ name: "Test" });

    expect(res.status).toBe(401);
  });
});
