"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  fatal: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const recurringRouter = require("./recurringDonations");
const adminRouter = require("./admin");

process.env.JWT_SECRET = "test-secret-for-jest";
process.env.ADMIN_API_KEY = "test-admin-key";

const DONOR = `G${"A".repeat(55)}`;
const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/recurring-donations", recurringRouter);
  app.use("/api/admin", adminRouter);
  return app;
}

function mockProjectAndInsert(amount) {
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes("FROM projects")) {
      return { rows: [{ id: PROJECT_ID, name: "Test", status: "active" }] };
    }
    if (sql.includes("INSERT INTO recurring_donations")) {
      return {
        rows: [
          {
            id: "pledge-1",
            donor_address: DONOR,
            project_id: PROJECT_ID,
            amount_xlm: String(amount),
            currency: "XLM",
            next_due_date: "2026-01-01",
            duration_months: 6,
            remaining_months: 6,
            status: "active",
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      };
    }
    return { rows: [] };
  });
}

describe("recurring donation max limit", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    recurringRouter._resetMaxRecurringAmountForTests();
    app = buildApp();
  });

  afterEach(() => {
    recurringRouter._resetMaxRecurringAmountForTests();
  });

  test("rejects schedule creation above default max with 400", async () => {
    const res = await request(app).post("/api/recurring-donations").send({
      donorAddress: DONOR,
      projectId: PROJECT_ID,
      amountXlm: 9999999,
      durationMonths: 6,
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/amountXlm exceeds maximum of 10000 XLM/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("accepts schedule creation at or below max", async () => {
    mockProjectAndInsert(500);

    const res = await request(app).post("/api/recurring-donations").send({
      donorAddress: DONOR,
      projectId: PROJECT_ID,
      amountXlm: 500,
      durationMonths: 6,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test("admin PUT updates runtime limit", async () => {
    const res = await request(app)
      .put("/api/admin/recurring-max-amount")
      .set("X-Admin-Key", "test-admin-key")
      .send({ maxAmountXlm: 500 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.maxAmountXlm).toBe(500);
    expect(recurringRouter.getMaxRecurringAmount()).toBe(500);
  });

  test("subsequent creation respects updated limit", async () => {
    await request(app)
      .put("/api/admin/recurring-max-amount")
      .set("X-Admin-Key", "test-admin-key")
      .send({ maxAmountXlm: 500 })
      .expect(200);

    const rejected = await request(app).post("/api/recurring-donations").send({
      donorAddress: DONOR,
      projectId: PROJECT_ID,
      amountXlm: 1000,
      durationMonths: 6,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/amountXlm exceeds maximum of 500 XLM/);

    mockProjectAndInsert(400);
    const accepted = await request(app).post("/api/recurring-donations").send({
      donorAddress: DONOR,
      projectId: PROJECT_ID,
      amountXlm: 400,
      durationMonths: 6,
    });
    expect(accepted.status).toBe(201);
  });
});
