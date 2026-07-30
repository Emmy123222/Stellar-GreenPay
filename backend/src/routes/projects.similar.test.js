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
  server: { getTransaction: jest.fn() },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-1234-5678-90ab-cdef"),
}));

const pool = require("../db/pool");
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

const MOCK_PROJECT = {
  id: "proj-1",
  name: "Amazon Reforestation",
  category: "Reforestation",
  description: "A big reforestation project",
  location: "Brazil",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  goal_xlm: "50000",
  raised_xlm: "25000",
  donor_count: 100,
  co2_offset_kg: 50000,
  status: "active",
  verified: true,
  on_chain_verified: false,
  tags: ["reforestation", "amazon"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const MOCK_SIMILAR = {
  id: "proj-2",
  name: "Atlantic Forest Restoration",
  category: "Reforestation",
  description: "Restoring the Atlantic Forest",
  location: "Brazil, South America",
  wallet_address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  goal_xlm: "30000",
  raised_xlm: "15000",
  donor_count: 50,
  co2_offset_kg: 30000,
  status: "active",
  verified: false,
  on_chain_verified: false,
  tags: ["reforestation"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("GET /api/projects/:id/similar", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns similar projects by category using SIMILARITY ordering", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT] }); // project lookup
    pool.query.mockResolvedValueOnce({ rows: [MOCK_SIMILAR] }); // similar query

    const res = await request(app)
      .get("/api/projects/proj-1/similar")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Atlantic Forest Restoration");
    expect(res.body.data[0].category).toBe("Reforestation");
  });

  test("returns 404 for non-existent project", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app)
      .get("/api/projects/nonexistent/similar")
      .expect(404);
  });

  test("falls back to donor_count ordering when SIMILARITY is not available", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT] });
    // First query throws SIMILARITY error
    const simError = new Error("function similarity(text, text) does not exist");
    simError.code = "42883";
    pool.query.mockRejectedValueOnce(simError);
    // Fallback query succeeds
    pool.query.mockResolvedValueOnce({ rows: [MOCK_SIMILAR] });

    const res = await request(app)
      .get("/api/projects/proj-1/similar")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  test("returns empty array when no similar projects exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/projects/proj-1/similar")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  test("excludes the current project from results", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/projects/proj-1/similar")
      .expect(200);

    expect(res.body.data.every((p) => p.id !== "proj-1")).toBe(true);
  });

  test("only returns active projects", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT] });
    pool.query.mockResolvedValueOnce({ rows: [] }); // no active similar projects

    const res = await request(app)
      .get("/api/projects/proj-1/similar")
      .expect(200);

    expect(res.body.data).toHaveLength(0);
  });
});
