/**
 * src/routes/donations.donor-history.test.js
 * Tests for GET /api/donations/donor/:publicKey (issue #1080).
 *
 * High-volume donors have hundreds of donations, so the endpoint must return a
 * bounded keyset page plus the donor's total count, which the donor profile
 * page uses to show "Showing 20 of 147 donations".
 */
"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn() },
}));

jest.mock("geoip-lite", () => ({ lookup: jest.fn() }));

jest.mock("../services/profileQueue", () => ({
  enqueueProfileUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/redis", () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  del: jest.fn(async () => {}),
  deletePattern: jest.fn(async () => {}),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const donationsRouter = require("./donations");

const DONOR = `G${"A".repeat(55)}`;

/** Every SQL statement the route ran, in the order it was issued. */
let queries;

function buildApp() {
  const app = express();
  app.set("io", { emit: jest.fn(), to: () => ({ emit: jest.fn() }) });
  app.use("/api/donations", donationsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const app = buildApp();

/**
 * Build a donation row as Postgres returns it.
 *
 * @param {number} index - Descending position within the donor's history.
 * @returns {object} Row matching the `donations` table shape.
 */
function donationRow(index) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    project_id: "proj-1",
    donor_address: DONOR,
    amount_xlm: "10.0000000",
    amount: "10",
    currency: "XLM",
    message: null,
    transaction_hash: "a".repeat(64),
    co2_per_xlm: "0.5",
    created_at: new Date(Date.UTC(2026, 0, 10 - index, 12)).toISOString(),
  };
}

/**
 * Serve the page query and the total query independently of call order — the
 * route runs them concurrently, so ordinal mocks would be flaky.
 *
 * @param {object} options - Stubbed page rows and total count.
 */
function stubQueries({ rows, total }) {
  queries = [];
  pool.query.mockImplementation((sql, params) => {
    queries.push({ sql, params });
    if (/COUNT\(\*\)::int AS total/.test(sql)) {
      return Promise.resolve({ rows: [{ total }] });
    }
    return Promise.resolve({ rows });
  });
}

beforeEach(() => {
  pool.query.mockReset();
});

describe("GET /api/donations/donor/:publicKey", () => {
  it("returns a bounded first page with a total that reflects the whole history", async () => {
    // 21 rows for a default limit of 20: the over-fetch signals there is more.
    const page = Array.from({ length: 21 }, (_, i) => donationRow(i));
    stubQueries({ rows: page, total: 147 });

    const res = await request(app).get(`/api/donations/donor/${DONOR}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, total: 147, has_more: true });
    expect(res.body.data).toHaveLength(20);
  });

  it("asks Postgres for one row more than the page size", async () => {
    stubQueries({ rows: [donationRow(0)], total: 1 });

    await request(app).get(`/api/donations/donor/${DONOR}`);

    const pageQuery = queries.find(({ sql }) => !/COUNT/.test(sql));
    expect(pageQuery.sql).toContain("LIMIT");
    expect(pageQuery.params).toEqual([DONOR, 21]);
  });

  it("honours an explicit limit", async () => {
    stubQueries({ rows: [], total: 0 });

    await request(app).get(`/api/donations/donor/${DONOR}?limit=5`);

    const pageQuery = queries.find(({ sql }) => !/COUNT/.test(sql));
    expect(pageQuery.params).toEqual([DONOR, 6]);
  });

  it("caps the limit so a caller cannot ask for the whole table", async () => {
    stubQueries({ rows: [], total: 0 });

    await request(app).get(`/api/donations/donor/${DONOR}?limit=5000`);

    const pageQuery = queries.find(({ sql }) => !/COUNT/.test(sql));
    expect(pageQuery.params[1]).toBe(101);
  });

  it("counts every donation, not just the returned page", async () => {
    stubQueries({ rows: Array.from({ length: 21 }, (_, i) => donationRow(i)), total: 147 });

    const res = await request(app).get(`/api/donations/donor/${DONOR}`);

    const countQuery = queries.find(({ sql }) => /COUNT/.test(sql));
    // The COUNT must ignore the keyset window and the LIMIT.
    expect(countQuery.sql).not.toContain("LIMIT");
    expect(countQuery.sql).not.toMatch(/created_at < /);
    expect(countQuery.params).toEqual([DONOR]);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.total).toBe(147);
  });

  it("hands back a cursor that resumes after the last returned row", async () => {
    const page = Array.from({ length: 21 }, (_, i) => donationRow(i));
    stubQueries({ rows: page, total: 147 });

    const res = await request(app).get(`/api/donations/donor/${DONOR}`);

    const last = res.body.data[res.body.data.length - 1];
    const cursor = JSON.parse(Buffer.from(res.body.next_cursor, "base64").toString("utf8"));
    expect(cursor).toEqual({ created_at: last.createdAt, id: last.id });
  });

  it("filters on the cursor and stops paginating on the final page", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        created_at: "2026-01-05T12:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000005",
      }),
    ).toString("base64");
    stubQueries({ rows: [donationRow(6)], total: 7 });

    const res = await request(app).get(
      `/api/donations/donor/${DONOR}?limit=20&cursor=${cursor}`,
    );

    expect(res.body).toMatchObject({ has_more: false, next_cursor: null, total: 7 });
    const pageQuery = queries.find(({ sql }) => !/COUNT/.test(sql));
    expect(pageQuery.sql).toContain("d.created_at < $2::timestamptz");
    expect(pageQuery.params).toEqual([
      DONOR,
      "2026-01-05T12:00:00.000Z",
      "00000000-0000-4000-8000-000000000005",
      21,
    ]);
  });

  it.each([
    ["not-base64", "unparsable cursor"],
    [Buffer.from(JSON.stringify({ id: "only-id" })).toString("base64"), "incomplete cursor"],
  ])("rejects a %s (%s)", async (cursor) => {
    stubQueries({ rows: [], total: 0 });

    const res = await request(app).get(`/api/donations/donor/${DONOR}?cursor=${cursor}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid cursor" });
    // A bad cursor is rejected before any query runs.
    expect(queries).toHaveLength(0);
  });

  it("validates the donor public key", async () => {
    stubQueries({ rows: [], total: 0 });

    const res = await request(app).get("/api/donations/donor/not-a-wallet");

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
