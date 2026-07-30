"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-1234-5678-90ab-cdef"),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const adminRouter = require("./admin");

process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "testpass";
process.env.JWT_SECRET = "test-secret-for-jest";
process.env.ADMIN_API_KEY = "test-admin-key";

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

async function getAdminToken() {
  const app = buildApp();
  const res = await request(app)
    .post("/api/admin/login")
    .send({ username: "admin", password: "testpass" });
  return res.body.data.token;
}

describe("POST /api/admin/projects/import", () => {
  let app;
  let token;

  beforeEach(async () => {
    app = buildApp();
    token = await getAdminToken();
    jest.clearAllMocks();
  });

  test("returns 400 when no file is uploaded", async () => {
    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);

    expect(res.body.error).toMatch(/file/i);
  });

  test("returns 400 when CSV has missing columns", async () => {
    const csvContent = "name,description\nMy Project,Some description\n";

    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(400);

    expect(res.body.error).toMatch(/Missing required CSV columns/i);
  });

  test("successfully imports valid CSV rows", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const csvContent =
      "name,description,category,location,walletAddress,goalXLM,co2PerXLM\n" +
      "Amazon Reforest,A large reforestation project in Brazil,Reforestation,Brazil,GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA,50000,0.5\n" +
      "Solar Kenya,Solar microgrids for rural Kenya,Solar Energy,Kenya,GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB,75000,0.3\n";

    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.imported).toBe(2);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.errors).toHaveLength(0);
    // pool.query called twice for project inserts + once for audit log
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  test("reports validation errors for invalid rows", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const csvContent =
      "name,description,category,location,walletAddress,goalXLM,co2PerXLM\n" +
      "AB,A short description that is too short,InvalidCategory,X,G...,notanumber,notanumber\n" +
      ",,InvalidCat,,,,,\n";

    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(200);

    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.failed).toBeGreaterThan(0);
    expect(res.body.data.errors.length).toBeGreaterThan(0);
  });

  test("handles mixed valid and invalid rows", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const csvContent =
      "name,description,category,location,walletAddress,goalXLM,co2PerXLM\n" +
      "Amazon Reforest,A large reforestation project in Brazil,Reforestation,Brazil,GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF,50000,0.5\n" +
      "Invalid,Short,Invalid,Y,,,,,,\n";

    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(200);

    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.failed).toBe(1);
  });

  test("handles quoted CSV fields with commas", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const csvContent =
      "name,description,category,location,walletAddress,goalXLM,co2PerXLM\n" +
      '"Amazon, Brazil Reforest","A large, impactful project",Reforestation,"Sao Paulo, Brazil",GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF,50000,0.5\n';

    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(200);

    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.failed).toBe(0);
  });

  test("returns 401 without admin authentication", async () => {
    const csvContent = "name,description,category,location,walletAddress,goalXLM,co2PerXLM\nTest,Description long enough,Solar Energy,Kenya,GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF,1000,0.1\n";

    await request(app)
      .post("/api/admin/projects/import")
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(401);
  });

  test("rejects CSV with no data rows", async () => {
    const csvContent = "name,description,category,location,walletAddress,goalXLM,co2PerXLM\n";

    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(400);

    expect(res.body.error).toMatch(/at least one data row/i);
  });

  test("handles database insertion errors gracefully", async () => {
    pool.query.mockRejectedValueOnce(new Error("duplicate key violation"));

    const csvContent =
      "name,description,category,location,walletAddress,goalXLM,co2PerXLM\n" +
      "Amazon Reforest,A large reforestation project in Brazil,Reforestation,Brazil,GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF,50000,0.5\n";

    const res = await request(app)
      .post("/api/admin/projects/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csvContent), "test.csv")
      .expect(200);

    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors[0].error).toMatch(/Database error/);
  });
});
