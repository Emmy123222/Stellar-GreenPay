"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/redis", () => ({ get: jest.fn(), set: jest.fn() }));

const request = require("supertest");
const express = require("express");
const pool = require("../db/pool");
const certificateRouter = require("./certificate");
const impactRouter = require("./impact");

// eslint-disable-next-line no-unused-vars
const errorMiddleware = (err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message });
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/impact/certificate", certificateRouter);
  app.use(errorMiddleware);
  return app;
}

// Mirrors how server.js mounts both routers under /api/impact so the restored
// certificate router cannot shadow the impact router's public slug endpoint.
function buildMountedApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/impact/certificate", certificateRouter);
  app.use("/api/impact", impactRouter);
  app.use(errorMiddleware);
  return app;
}

const DONATION_ID = "1f0f8a7c-6f67-4c2f-9a58-3a51a3f7d1e9";
const TX_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const DONOR = "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN";

function donationRow(overrides) {
  return Object.assign(
    {
      id: DONATION_ID,
      project_id: "8b6f1c4e-2a3d-4f5b-9c7e-1d2a3b4c5d6e",
      donor_address: DONOR,
      transaction_hash: TX_HASH,
      amount_xlm: "12.5000000",
      currency: "XLM",
      created_at: "2026-01-15T10:00:00.000Z",
      project_name: "Mangrove Restoration",
      project_category: "Reforestation",
      project_verified: true,
      project_on_chain_verified: false,
      co2_per_xlm: "2.4",
      donor_name: "Ada Lovelace",
    },
    overrides || {},
  );
}

describe("GET /api/impact/certificate/donation/:id", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    pool.query.mockReset();
  });

  test("returns certificate data for a donation id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [donationRow()] });

    const res = await request(app)
      .get(`/api/impact/certificate/donation/${DONATION_ID}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      donationId: DONATION_ID,
      transactionHash: TX_HASH,
      donorAddress: DONOR,
      donorName: "Ada Lovelace",
      projectId: "8b6f1c4e-2a3d-4f5b-9c7e-1d2a3b4c5d6e",
      projectName: "Mangrove Restoration",
      projectCategory: "Reforestation",
      projectVerified: true,
      amountXLM: "12.5000000",
      currency: "XLM",
      co2OffsetKg: 30,
      treesEquivalent: 1.38,
    });
    expect(res.body.data.recordUrl).toContain(TX_HASH);
    expect(res.body.data.donatedAt).toBe("2026-01-15T10:00:00.000Z");
    expect(typeof res.body.data.issuedAt).toBe("string");

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM donations/);
    expect(sql).toMatch(/JOIN projects/);
    expect(sql).toMatch(/WHERE d\.id = \$1/);
    expect(params).toEqual([DONATION_ID]);
  });

  test("finds the certificate by transaction hash", async () => {
    pool.query.mockResolvedValueOnce({ rows: [donationRow()] });

    const res = await request(app)
      .get(`/api/impact/certificate/donation/${TX_HASH}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.donationId).toBe(DONATION_ID);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE d\.transaction_hash = \$1/);
    expect(params).toEqual([TX_HASH]);
  });

  test("unknown donation id → 404", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/impact/certificate/donation/${DONATION_ID}`)
      .expect(404);

    expect(res.body).toEqual({ success: false, error: "Certificate not found" });
  });

  test("unknown transaction hash → 404", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/impact/certificate/donation/${TX_HASH}`)
      .expect(404);

    expect(res.body).toEqual({ success: false, error: "Certificate not found" });
  });

  test("malformed id → 400 and no database lookup", async () => {
    const res = await request(app)
      .get("/api/impact/certificate/donation/not-a-donation-id")
      .expect(400);

    expect(res.body).toEqual({ success: false, error: "Invalid donation id" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("database failure → 500 with the error message", async () => {
    pool.query.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app)
      .get(`/api/impact/certificate/donation/${DONATION_ID}`)
      .expect(500);

    expect(res.body.error).toBe("connection refused");
  });

  test("missing donor profile yields a null donorName", async () => {
    pool.query.mockResolvedValueOnce({ rows: [donationRow({ donor_name: null })] });

    const res = await request(app)
      .get(`/api/impact/certificate/donation/${DONATION_ID}`)
      .expect(200);

    expect(res.body.data.donorName).toBeNull();
  });
});

describe("mount order (certificate router + impact router, as in server.js)", () => {
  let app;

  beforeEach(() => {
    app = buildMountedApp();
    pool.query.mockReset();
  });

  test("the certificate router answers /api/impact/certificate/donation/:id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [donationRow()] });

    const res = await request(app)
      .get(`/api/impact/certificate/donation/${DONATION_ID}`)
      .expect(200);

    expect(res.body.data.donationId).toBe(DONATION_ID);

    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM donations/);
  });

  test("the impact router still owns the public /certificate/:slug endpoint", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          slug: "brave-fox-42",
          donor_address: DONOR,
          donor_name: "Ada Lovelace",
          total_donated_xlm: "100.0000000",
          co2_offset_kg: 45,
          badge_tier: "Supporter",
          projects_supported: [],
          created_at: "2026-01-15T10:00:00.000Z",
        },
      ],
    });

    const res = await request(app)
      .get("/api/impact/certificate/brave-fox-42")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.slug).toBe("brave-fox-42");

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM impact_certificates/);
    expect(params).toEqual(["brave-fox-42"]);
  });
});
