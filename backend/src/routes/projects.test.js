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
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
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

describe("POST /api/projects", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("rejects HTML in project name with 422 field errors", async () => {
    const res = await request(app)
      .post("/api/projects")
      .send({
        name: "<script>Bad</script>",
        description: "A test climate project that is long enough",
        location: "Brazil",
        category: "Reforestation",
        wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        goal_xlm: 100,
      })
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.name).toBeDefined();
  });
});

describe("POST /api/projects/:id/generate-summary", () => {
  let app;

  const OWNER_ADDRESS = "GSEEDLING" + "A".repeat(47);
  const OTHER_ADDRESS = "GDIFFERENT" + "B".repeat(46);

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns 403 when caller is not the project owner", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: "proj-1",
        name: "Test Project",
        category: "Reforestation",
        description: "A test climate project",
        wallet_address: OWNER_ADDRESS,
      }],
    });

    const res = await request(app)
      .post("/api/projects/proj-1/generate-summary")
      .send({ adminAddress: OTHER_ADDRESS });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only the project owner can generate a summary");
  });
});
