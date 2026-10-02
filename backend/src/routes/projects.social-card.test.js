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
  co2_offset_kg: "50000",
  raised_xlm: "25000",
};

const VALID_DONOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("GET /api/projects/:id/social-card", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns social card with badge tier for valid donation", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT] });

    const res = await request(app)
      .get(`/api/projects/proj-1/social-card?donorAddress=${VALID_DONOR}&amount=250`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.text).toContain("I donated 250 XLM");
    expect(d.text).toContain("Amazon Reforestation");
    expect(d.text).toContain("kg CO₂");
    expect(d.text).toContain("My badge:");
    expect(d.projectName).toBe("Amazon Reforestation");
    expect(d.amount).toBe("250.0000000");
    expect(d.co2OffsetKg).toBeGreaterThan(0);
    expect(d.treesEquivalent).toBeGreaterThan(0);
    expect(d.badgeTier).toBe("tree"); // 250 XLM → tree badge
    expect(d.badgeEmoji).toBe("🌳");
  });

  test("returns seedling badge for small donation", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT] });

    const res = await request(app)
      .get(`/api/projects/proj-1/social-card?donorAddress=${VALID_DONOR}&amount=15`)
      .expect(200);

    expect(res.body.data.badgeTier).toBe("seedling");
    expect(res.body.data.badgeEmoji).toBe("🌱");
  });

  test("returns earth badge for large donation (2000+ XLM)", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT] });

    const res = await request(app)
      .get(`/api/projects/proj-1/social-card?donorAddress=${VALID_DONOR}&amount=2000`)
      .expect(200);

    expect(res.body.data.badgeTier).toBe("earth");
    expect(res.body.data.badgeEmoji).toBe("🌍");
  });

  test("returns 400 when donorAddress is missing", async () => {
    const res = await request(app)
      .get("/api/projects/proj-1/social-card?amount=50")
      .expect(400);

    expect(res.body.error).toMatch(/donorAddress/i);
  });

  test("returns 400 when donorAddress is invalid", async () => {
    const res = await request(app)
      .get("/api/projects/proj-1/social-card?donorAddress=BADKEY&amount=50")
      .expect(400);

    expect(res.body.error).toMatch(/donorAddress/i);
  });

  test("returns 400 when amount is missing", async () => {
    const res = await request(app)
      .get(`/api/projects/proj-1/social-card?donorAddress=${VALID_DONOR}`)
      .expect(400);

    expect(res.body.error).toMatch(/amount/i);
  });

  test("returns 400 when amount is not positive", async () => {
    const res = await request(app)
      .get(`/api/projects/proj-1/social-card?donorAddress=${VALID_DONOR}&amount=-5`)
      .expect(400);

    expect(res.body.error).toMatch(/amount/i);
  });

  test("returns 404 for non-existent project", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app)
      .get(`/api/projects/nonexistent/social-card?donorAddress=${VALID_DONOR}&amount=50`)
      .expect(404);
  });

  test("co2OffsetKg is proportional to donation amount", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT] });

    const res = await request(app)
      .get(`/api/projects/proj-1/social-card?donorAddress=${VALID_DONOR}&amount=500`)
      .expect(200);

    // Project: 50000 kg / 25000 XLM = 2 kg/XLM. 500 XLM × 2 = 1000 kg
    expect(res.body.data.co2OffsetKg).toBe(1000);
  });

  test("returns null badge tier for tiny donation (< 10 XLM)", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_PROJECT] });

    const res = await request(app)
      .get(`/api/projects/proj-1/social-card?donorAddress=${VALID_DONOR}&amount=5`)
      .expect(200);

    expect(res.body.data.badgeTier).toBeNull();
    expect(res.body.data.text).toContain("My badge: Supporter");
  });
});
