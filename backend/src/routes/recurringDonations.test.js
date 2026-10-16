/**
 * src/routes/recurringDonations.test.js
 *
 * Covers the API contract the mobile app treats as the source of truth for
 * recurring schedules (#1059): the `{ success, data }` envelope, camelCase
 * row mapping, and the donor-address filter used by client-side sync.
 */
"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../services/recurringDonationQueue", () => ({
  scheduleRecurringDonationJob: jest.fn().mockResolvedValue(undefined),
  cancelRecurringDonationJob: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  fatal: jest.fn(),
}));

const request = require("supertest");
const express = require("express");
const pool = require("../db/pool");
const router = require("./recurringDonations");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/recurring-donations", router);
  return app;
}

const DB_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  donor_address: "G".padEnd(56, "A"),
  project_id: "22222222-2222-4222-8222-222222222222",
  project_name: "Amazon Reforestation",
  amount_xlm: "50.0000000",
  currency: "XLM",
  next_due_date: new Date(Date.UTC(2026, 11, 5)),
  duration_months: 6,
  remaining_months: 4,
  status: "active",
  created_at: new Date(Date.UTC(2026, 0, 5)),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/recurring-donations", () => {
  test("returns the envelope and camelCase fields mobile parses", async () => {
    pool.query.mockResolvedValue({ rows: [DB_ROW] });

    const res = await request(buildApp()).get("/api/recurring-donations");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      id: DB_ROW.id,
      donorAddress: DB_ROW.donor_address,
      projectName: "Amazon Reforestation",
      amountXlm: 50,
      nextDueDate: "2026-12-05",
      durationMonths: 6,
      remainingMonths: 4,
      status: "active",
      createdAt: "2026-01-05T00:00:00.000Z",
    });
  });

  test("scopes the query by donor address when the client syncs one account", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(buildApp()).get("/api/recurring-donations").query({ donor: DB_ROW.donor_address });

    const [, values] = pool.query.mock.calls[0];
    expect(values).toEqual([DB_ROW.donor_address]);
  });

  test("rejects a malformed donor address with 400 instead of querying", async () => {
    const res = await request(buildApp())
      .get("/api/recurring-donations")
      .query({ donor: "not-a-stellar-key" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects an unknown status filter with 400", async () => {
    const res = await request(buildApp())
      .get("/api/recurring-donations")
      .query({ status: "paused_forever" });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("POST /api/recurring-donations", () => {
  const VALID_BODY = {
    donorAddress: DB_ROW.donor_address,
    projectId: DB_ROW.project_id,
    amountXlm: 50,
    durationMonths: 6,
    startDate: "2026-01-05",
  };

  test("persists the pledge and returns the server-authored schedule", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_BODY.projectId, name: "Amazon Reforestation", status: "active" }] })
      .mockResolvedValueOnce({ rows: [DB_ROW] });

    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.nextDueDate).toBe("2026-12-05");
    const [sql, values] = pool.query.mock.calls[1];
    expect(sql).toContain("INSERT INTO recurring_donations");
    expect(values).toContain(VALID_BODY.donorAddress);
    // The client never sends a due date: the server owns the schedule.
    expect(values).toContain("2026-01-05");
  });

  test("rejects a pledge without a fixed term (open-ended is not persistable)", async () => {
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...VALID_BODY, durationMonths: null });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/recurring-donations/:id", () => {
  test("cancels the pledge so other devices stop firing it", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...DB_ROW, status: "cancelled" }] });

    const res = await request(buildApp()).delete(`/api/recurring-donations/${DB_ROW.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });
});

// ── Ported from recurring-donations.test.js (deleted in #1536) ────────────────
// Covers the 1 XLM minimum floor that only existed in the unmounted kebab-case
// file. Uses camelCase field name `amountXlm` and the mounted router's response
// shape: { success: false, error: "..." } at HTTP 400.

describe("POST /api/recurring-donations — minimum amount (ported from #1536)", () => {
  const BASE_BODY = {
    donorAddress: DB_ROW.donor_address,
    projectId:    DB_ROW.project_id,
    durationMonths: 6,
  };

  // Shared fixture: make the DB happy for amounts that pass validation.
  function mockDbAccept(amountXlm) {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: DB_ROW.project_id, name: "Test", status: "active" }] })
      .mockResolvedValueOnce({ rows: [{ ...DB_ROW, amount_xlm: String(amountXlm) }] });
  }

  test("accepts exactly 1 XLM (minimum boundary)", async () => {
    mockDbAccept(1);
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: 1 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test("accepts an amount greater than 1 XLM", async () => {
    mockDbAccept(25.5);
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: 25.5 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test("rejects 0 XLM with 400 and minimum-amount message", async () => {
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: 0 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects 0.5 XLM (below minimum) with 400", async () => {
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: 0.5 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects 0.9999999 XLM (just below minimum) with 400", async () => {
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: 0.9999999 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects a negative amount with 400", async () => {
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: -5 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // Negative fails the "> 0" check first; either message is acceptable.
    expect(res.body.error).toMatch(/positive number|Minimum recurring donation/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects a non-numeric string amount with 400", async () => {
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("accepts amountXlm supplied as a string '1'", async () => {
    mockDbAccept(1);
    const res = await request(buildApp())
      .post("/api/recurring-donations")
      .send({ ...BASE_BODY, amountXlm: "1" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
