"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../services/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
  deletePattern: jest.fn(),
}));

jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn(),
  CONTRACT_ID: "test-contract",
  server: {
    loadAccount: jest.fn(),
  },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

jest.mock("../services/summaryQueue", () => ({
  enqueueAISummary: jest.fn(),
}));

const pool = require("../db/pool");
const redis = require("../services/redis");
const { server } = require("../services/stellar");
const express = require("express");
const request = require("supertest");
const projectsRouter = require("./projects");

process.env.ADMIN_API_KEY = "test-admin-key";

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
    jest.resetAllMocks();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null);
    redis.deletePattern.mockResolvedValue(null);
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

describe("PATCH /api/projects/:id/status", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.resetAllMocks();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null);
    redis.deletePattern.mockResolvedValue(null);
  });

  test("invalidates cached project list entries when status changes", async () => {
    const staleCachedResponse = { success: true, data: [{ ...MOCK_PROJECT_ROW, status: "active" }], has_more: false };
    const updatedProject = { ...MOCK_PROJECT_ROW, status: "paused" };

    let cacheEnabled = true;
    redis.get.mockImplementation(async () => (cacheEnabled ? staleCachedResponse : null));
    redis.deletePattern.mockImplementation(async () => {
      cacheEnabled = false;
    });

    pool.query
      .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] })
      .mockResolvedValueOnce({ rows: [updatedProject] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [updatedProject] });

    const cachedRes = await request(app).get("/api/projects").expect(200);
    expect(cachedRes.body).toEqual(staleCachedResponse);

    const patchRes = await request(app).patch("/api/projects/proj-1/status").send({ status: "paused" }).expect(200);
    expect(patchRes.body.data.status).toBe("paused");
    expect(redis.deletePattern).toHaveBeenCalledWith("projects:list:*");

    const freshRes = await request(app).get("/api/projects").expect(200);
    expect(freshRes.body.success).toBe(true);
    expect(freshRes.body.data[0].status).toBe("paused");
    expect(freshRes.body.has_more).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(4);
  });
});

describe("GET /api/projects/:id", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.resetAllMocks();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null);
    redis.deletePattern.mockResolvedValue(null);
  });

  test("returns a single project", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT_ROW] });
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] }); // project
    pool.query.mockResolvedValueOnce({ rows: [] }); // campaigns
    pool.query.mockResolvedValueOnce({ rows: [{ avg_rating: null, count: 0 }] }); // ratings
    pool.query.mockResolvedValueOnce({ rows: [{ count: 5 }] }); // subscriber count
    pool.query.mockResolvedValueOnce({ rows: [] }); // milestones

    const res = await request(app).get("/api/projects/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Test Project");
    expect(res.body.data.subscriberCount).toBe(5);
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
    jest.resetAllMocks();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null);
    redis.deletePattern.mockResolvedValue(null);
  });

  test("returns 400 when adminAddress is missing", async () => {
    const res = await request(app)
      .post("/api/projects/admin/register")
      .send({ name: "Test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("adminAddress is required");
  });

  test("returns 400 for invalid adminAddress before loading account", async () => {
    const res = await request(app)
      .post("/api/projects/admin/register")
      .send({
        projectId: "proj-1",
        name: "Test",
        wallet: MOCK_PROJECT_ROW.wallet_address,
        co2PerXLM: 10,
        adminAddress: "not-a-stellar-address",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar public key");
    expect(server.loadAccount).not.toHaveBeenCalled();
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

  test("rejects requests with an invalid admin key", async () => {
    const res = await request(app)
      .patch("/api/projects/proj-1/status")
      .set("X-Admin-Key", "wrong")
      .send({ status: "active", adminAddress: "GADMIN" });

    expect(res.status).toBe(401);
  });

  test("allows status updates with a valid admin key", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] })
      .mockResolvedValueOnce({ rows: [{ ...MOCK_PROJECT_ROW, status: "paused" }] });
    redis.deletePattern.mockResolvedValue(0);

    const res = await request(app)
      .patch("/api/projects/proj-1/status")
      .set("X-Admin-Key", "test-admin-key")
      .send({ status: "paused", reason: "maintenance", adminAddress: "GADMIN" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(redis.deletePattern).toHaveBeenCalledWith("projects:list:*");
  });
});

describe("mapCampaignRow", () => {
  const mapCampaignRow = projectsRouter.mapCampaignRow;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-30T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const getBaseRow = () => ({
    id: "camp-1",
    project_id: "proj-1",
    title: "Test Campaign",
    description: "Testing",
    goal_xlm: "1000",
    raised_xlm: "500",
    deadline: new Date("2026-07-30T00:00:00.000Z").toISOString(),
    created_at: new Date("2026-06-01T00:00:00.000Z").toISOString(),
  });

  test("raised_xlm >= goal_xlm → completed: true, active: false", () => {
    const row = getBaseRow();
    row.raised_xlm = "1000";
    let mapped = mapCampaignRow(row);
    expect(mapped.completed).toBe(true);
    expect(mapped.active).toBe(false);

    row.raised_xlm = "1500";
    mapped = mapCampaignRow(row);
    expect(mapped.completed).toBe(true);
    expect(mapped.active).toBe(false);
  });

  test("Current time past deadline → completed: true, active: false", () => {
    const row = getBaseRow();
    row.deadline = new Date("2026-06-29T00:00:00.000Z").toISOString();
    const mapped = mapCampaignRow(row);
    expect(mapped.completed).toBe(true);
    expect(mapped.active).toBe(false);
  });

  test("Neither condition → completed: false, active: true", () => {
    const row = getBaseRow();
    const mapped = mapCampaignRow(row);
    expect(mapped.completed).toBe(false);
    expect(mapped.active).toBe(true);
  });

  test("goal_xlm = 0 → progressPercent = 0 (not NaN)", () => {
    const row = getBaseRow();
    row.goal_xlm = "0";
    row.raised_xlm = "500";
    const mapped = mapCampaignRow(row);
    expect(mapped.progressPercent).toBe(0);
    expect(mapped.completed).toBe(true);
  });
});
