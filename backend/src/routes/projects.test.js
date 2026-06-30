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

// ── GET /api/projects/:id/impact-certificate ──────────────────────────────────

// A real 56-char Stellar G-address used as the donor in these tests
const CERT_DONOR = "GAUUCYNO24CCKKNOMT5AS6D73J6QMYC5IJI64H4ZBJL7NQUETW3KOO4J";

const MOCK_DONATION_ROW = {
  id: "don-1",
  amount_xlm: "250.0000000",
  message: "Keep it up!",
  transaction_hash: "abc123",
  created_at: new Date("2025-06-01T12:00:00Z").toISOString(),
};

describe("GET /api/projects/:id/impact-certificate", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.resetAllMocks();
    redis.get.mockResolvedValue(null);
  });

  test("returns 200 with certificate data for a valid donor", async () => {
    // 1. project found
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Amazon Reforestation", raised_xlm: "1000", co2_offset_kg: "5000" }],
    });
    // 2. donations found
    pool.query.mockResolvedValueOnce({ rows: [MOCK_DONATION_ROW] });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.projectId).toBe("proj-1");
    expect(d.projectName).toBe("Amazon Reforestation");
    expect(d.donorAddress).toBe(CERT_DONOR);
    expect(d.donationCount).toBe(1);
    expect(d.donations).toHaveLength(1);
    expect(d.donations[0].transactionHash).toBe("abc123");
    expect(typeof d.totalDonatedXLM).toBe("string");
    expect(typeof d.co2OffsetKg).toBe("number");
    expect(typeof d.treesEquivalent).toBe("number");
    expect(d.issuedAt).toBeTruthy();
  });

  test("assigns bronze badge tier when donor gave < 100 XLM", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "1000", co2_offset_kg: "5000" }],
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_DONATION_ROW, amount_xlm: "50.0000000" }],
    });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.data.badgeTier).toBe("bronze");
  });

  test("assigns silver badge tier when donor gave >= 100 XLM", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "1000", co2_offset_kg: "5000" }],
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_DONATION_ROW, amount_xlm: "100.0000000" }],
    });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.data.badgeTier).toBe("silver");
  });

  test("assigns gold badge tier when donor gave >= 1000 XLM", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "2000", co2_offset_kg: "10000" }],
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_DONATION_ROW, amount_xlm: "1000.0000000" }],
    });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.data.badgeTier).toBe("gold");
  });

  test("assigns platinum badge tier when donor gave >= 10000 XLM", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "20000", co2_offset_kg: "100000" }],
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_DONATION_ROW, amount_xlm: "10000.0000000" }],
    });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.data.badgeTier).toBe("platinum");
  });

  test("returns 400 when donorAddress is missing", async () => {
    const res = await request(app)
      .get("/api/projects/proj-1/impact-certificate")
      .expect(400);

    expect(res.body.error).toMatch(/donorAddress/i);
  });

  test("returns 400 when donorAddress is invalid (too short)", async () => {
    const res = await request(app)
      .get("/api/projects/proj-1/impact-certificate?donorAddress=GBADKEY")
      .expect(400);

    expect(res.body.error).toMatch(/donorAddress/i);
  });

  test("returns 400 when donorAddress starts with wrong letter", async () => {
    const res = await request(app)
      .get("/api/projects/proj-1/impact-certificate?donorAddress=XAUUCYNO24CCKKNOMT5AS6D73J6QMYC5IJI64H4ZBJL7NQUETW3KOO4J")
      .expect(400);

    expect(res.body.error).toMatch(/donorAddress/i);
  });

  test("returns 404 when project does not exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // project not found

    const res = await request(app)
      .get(`/api/projects/nonexistent/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(404);

    expect(res.body.error).toMatch(/project not found/i);
  });

  test("returns 404 when donor has no donations on this project", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "1000", co2_offset_kg: "5000" }],
    });
    pool.query.mockResolvedValueOnce({ rows: [] }); // no donations

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(404);

    expect(res.body.error).toMatch(/no donations found/i);
  });

  test("co2OffsetKg is proportional to donor's share of total raised", async () => {
    // project raised 1000 XLM, offset 5000 kg → 5 kg/XLM
    // donor gave 200 XLM → expected 1000 kg
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "1000", co2_offset_kg: "5000" }],
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_DONATION_ROW, amount_xlm: "200.0000000" }],
    });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.data.co2OffsetKg).toBe(1000);
  });

  test("co2OffsetKg is 0 when project has raised_xlm = 0", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "0", co2_offset_kg: "5000" }],
    });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_DONATION_ROW, amount_xlm: "100.0000000" }],
    });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.data.co2OffsetKg).toBe(0);
    expect(res.body.data.treesEquivalent).toBe(0);
  });

  test("aggregates multiple donations for the same donor", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "proj-1", name: "Test", raised_xlm: "1000", co2_offset_kg: "5000" }],
    });
    pool.query.mockResolvedValueOnce({
      rows: [
        { ...MOCK_DONATION_ROW, id: "don-1", amount_xlm: "100.0000000" },
        { ...MOCK_DONATION_ROW, id: "don-2", amount_xlm: "200.0000000" },
      ],
    });

    const res = await request(app)
      .get(`/api/projects/proj-1/impact-certificate?donorAddress=${CERT_DONOR}`)
      .expect(200);

    expect(res.body.data.donationCount).toBe(2);
    expect(res.body.data.donations).toHaveLength(2);
    // 300 XLM × (5000/1000 kg/XLM) = 1500 kg
    expect(res.body.data.co2OffsetKg).toBe(1500);
  });
});
