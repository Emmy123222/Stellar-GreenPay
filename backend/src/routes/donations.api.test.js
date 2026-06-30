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
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

const pool = require("../db/pool");
const redis = require("../services/redis");
const express = require("express");
const request = require("supertest");
const projectsRouter = require("./projects");

function buildApp() {
  const app = express();
  app.use(express.json());

  const io = { emit: jest.fn(), to: () => ({ emit: jest.fn() }) };
  app.set("io", io);

  app.use("/api/donations", donationsRouter);
  
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


  test("records a valid donation", async () => {
    createMockClient(
      { rows: [MOCK_PROJECT] },
      { rows: [] },
      undefined,
      { rows: [MOCK_DONATION_ROW] },
      { rows: [] },
      undefined,
      { rows: [{ ...MOCK_DONATION_ROW, total_donated_xlm: 100 }] },
      { rows: [{ count: "1" }] },
    );

    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: makePublicKey(),
        amountXLM: 100,
        currency: "XLM",
        message: "Great project!",
        transactionHash: makeTxHash(),
      })
      .expect(201);

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
    pool.query.mockResolvedValueOnce({ rows: [{ avg_rating: "4.5", count: "10" }] }); // ratings
    pool.query.mockResolvedValueOnce({ rows: [] }); // milestones

    const res = await request(app).get("/api/projects/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Test Project");
  });

  test("returns 404 for non-existent project", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/projects/nonexistent").expect(404);
  });
});

describe("GET /api/projects/:id/on-chain-donations", () => {
  let app;
  const stellarService = require("../services/stellar");

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns decoded on-chain donation events", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "proj-1" }] });
    stellarService.getProjectDonationEvents.mockResolvedValueOnce([
      {
        donor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        amount: "100000000",
        ledger: 1234,
        badge: "Seedling",
        msgHash: 987654,
        pagingToken: "1234-1",
      },
    ]);

    const res = await request(app)
      .get("/api/projects/proj-1/on-chain-donations?limit=10")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      {
        donor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        amount: "100000000",
        ledger: 1234,
        badge: "Seedling",
        msgHash: 987654,
      },
    ]);
    expect(res.body.nextCursor).toBe("1234-1");
  });

  test("returns 404 if project does not exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get("/api/projects/unknown/on-chain-donations")
      .expect(404);
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

describe("GET /api/donations/:id", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns full donation for valid UUID", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          ...MOCK_DONATION_ROW,
          project_name: "Amazon Reforestation",
          donor_display_name: "John Doe",
          co2_offset_kg: "500",
        },
      ],
    });

    const validId = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
    const res = await request(app)
      .get(`/api/donations/${validId}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.projectName).toBe("Amazon Reforestation");
    expect(res.body.data.donorDisplayName).toBe("John Doe");
    expect(res.body.data.co2OffsetKg).toBe(500);
  });

  test("returns 404 if donation not found", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const validId = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
    const res = await request(app)
      .get(`/api/donations/${validId}`)
      .expect(404);

    expect(res.body.error).toBe("Donation not found");
  });

  test("returns 400 for invalid UUID", async () => {
    const res = await request(app)
      .get("/api/donations/invalid-id")
      .expect(400);

    expect(res.body.error).toBe("Invalid donation ID");
  });
});
