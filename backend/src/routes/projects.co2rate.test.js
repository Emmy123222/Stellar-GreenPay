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
  getProjectDonationEvents: jest.fn(),
  getRegisteredProjectIdFromTransaction: jest.fn(),
  CONTRACT_ID: "test-contract",
  server: { getTransaction: jest.fn() },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

jest.mock("../services/summaryQueue", () => ({
  enqueueAISummary: jest.fn(),
}));

jest.mock("../services/audit", () => ({
  logAdminAction: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
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

const UPDATED_ROW = {
  id: "proj-1",
  name: "Test Project",
  description: "desc",
  category: "Reforestation",
  location: "Brazil",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  goal_xlm: "10000",
  raised_xlm: "5000",
  donor_count: 10,
  co2_offset_kg: 50000,
  co2_per_xlm: "2.5000000",
  status: "active",
  rejection_reason: null,
  verified: true,
  on_chain_verified: false,
  tags: [],
  created_at: new Date("2024-01-01T00:00:00.000Z"),
  updated_at: new Date("2024-01-02T00:00:00.000Z"),
};

describe("PATCH /api/projects/:id/co2-rate", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  function mockUpdate() {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "proj-1" }] })
      .mockResolvedValueOnce({ rows: [UPDATED_ROW] });
  }

  test("updates the rate with admin key and returns the project", async () => {
    mockUpdate();

    const res = await request(app)
      .patch("/api/projects/proj-1/co2-rate")
      .set("X-Admin-Key", "test-admin-key")
      .send({ co2_per_xlm: 2.5 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.co2PerXLM).toBe("2.5000000");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE projects"),
      ["2.5000000", "proj-1"],
    );
  });

  test("rejects unauthenticated requests with 401", async () => {
    await request(app)
      .patch("/api/projects/proj-1/co2-rate")
      .send({ co2_per_xlm: 2.5 })
      .expect(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects negative / missing rates with 400", async () => {
    await request(app)
      .patch("/api/projects/proj-1/co2-rate")
      .set("X-Admin-Key", "test-admin-key")
      .send({ co2_per_xlm: -1 })
      .expect(400);

    await request(app)
      .patch("/api/projects/proj-1/co2-rate")
      .set("X-Admin-Key", "test-admin-key")
      .send({})
      .expect(400);
  });

  test("unknown project → 404", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .patch("/api/projects/nope/co2-rate")
      .set("X-Admin-Key", "test-admin-key")
      .send({ co2_per_xlm: 1 })
      .expect(404);
  });
});
