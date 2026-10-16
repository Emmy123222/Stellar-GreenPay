"use strict";
/**
 * src/routes/donations.export.test.js
 *
 * Tests GET /api/donations/export?format=csv: wallet authentication, CSV
 * shape, historical USD pricing, and CSV escaping.
 */

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

jest.mock("geoip-lite", () => ({
  lookup: jest.fn(),
}));

jest.mock("../services/profileQueue", () => ({
  enqueueProfileUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/webhook", () => ({
  checkAndDeliverMilestones: jest.fn().mockResolvedValue(undefined),
}));

const mockRedis = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  del: jest.fn(async () => {}),
  deletePattern: jest.fn(async () => {}),
};
jest.mock("../services/redis", () => mockRedis);

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const donationsRouter = require("./donations");
const { signToken } = require("../middleware/auth");

const DONOR = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/donations", donationsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

function authHeader(address = DONOR) {
  return { Authorization: `Bearer ${signToken({ sub: address, type: "wallet" }, "1h")}` };
}

const DONATION_ROWS = [
  {
    created_at: new Date("2026-01-15T10:00:00Z"),
    project_name: "Amazon Reforestation",
    amount_xlm: "100.0000000",
    transaction_hash: "a".repeat(64),
    co2_per_xlm: "5000",
  },
  {
    created_at: new Date("2026-02-20T14:30:00Z"),
    project_name: "Solar for Schools",
    amount_xlm: "50.5000000",
    transaction_hash: "b".repeat(64),
    co2_per_xlm: "3000",
  },
];

/**
 * Mock the CoinGecko historical-price fetch. `prices` maps DD-MM-YYYY → USD.
 */
function mockCoinGeckoPrices(prices) {
  global.fetch = jest.fn().mockImplementation((url) => {
    if (typeof url === "string" && url.includes("coingecko.com")) {
      const datePart = url.match(/date=([^&]+)/)?.[1];
      const decoded = datePart ? decodeURIComponent(datePart) : null;
      const price = decoded != null ? prices[decoded] : undefined;
      if (price != null) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ market_data: { current_price: { usd: price } } }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }
    return Promise.reject(new Error("unexpected fetch"));
  });
}

afterEach(() => {
  delete global.fetch;
});

describe("GET /api/donations/export", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/donations/export?format=csv");
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects an unsupported format", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get("/api/donations/export?format=json")
      .set(authHeader());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/csv/i);
  });

  it("returns the donor history as a CSV attachment", async () => {
    pool.query.mockResolvedValue({ rows: DONATION_ROWS });
    mockCoinGeckoPrices({ "15-01-2026": 0.2, "20-02-2026": 0.25 });

    const res = await request(app)
      .get("/api/donations/export?format=csv")
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/donation-history\.csv/);

    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe("date,project_name,amount_xlm,amount_usd,co2_offset_kg,transaction_hash");
    expect(lines).toHaveLength(3);

    // Oldest first (ascending by date).
    expect(lines[1]).toBe(
      `2026-01-15,Amazon Reforestation,100.0000000,20.00,500.00,${"a".repeat(64)}`,
    );
    expect(lines[2]).toBe(
      `2026-02-20,Solar for Schools,50.5000000,12.63,151.50,${"b".repeat(64)}`,
    );
  });

  it("scopes the export to the authenticated donor", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    mockCoinGeckoPrices({});

    await request(app).get("/api/donations/export?format=csv").set(authHeader());

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual([DONOR]);
  });

  it("leaves the USD cell blank when the historical price is unavailable", async () => {
    // Use a date no other test caches, so the (failing) price fetch is
    // actually exercised rather than served from the module-level cache.
    pool.query.mockResolvedValue({
      rows: [
        {
          ...DONATION_ROWS[0],
          created_at: new Date("2026-03-10T09:00:00Z"),
        },
      ],
    });
    // CoinGecko responds but with no usable price.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });

    const res = await request(app)
      .get("/api/donations/export?format=csv")
      .set(authHeader());

    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\r\n");
    // amount_usd is empty (consecutive commas).
    expect(lines[1]).toContain("100.0000000,,500.00");
  });

  it("escapes project names containing commas", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          ...DONATION_ROWS[0],
          project_name: "Trees, Inc.",
        },
      ],
    });
    mockCoinGeckoPrices({ "15-01-2026": 0.2 });

    const res = await request(app)
      .get("/api/donations/export?format=csv")
      .set(authHeader());

    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\r\n");
    expect(lines[1]).toContain("\"Trees, Inc.\"");
  });

  it("returns only the header when the donor has no donations", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get("/api/donations/export?format=csv")
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe(
      "date,project_name,amount_xlm,amount_usd,co2_offset_kg,transaction_hash",
    );
  });
});
