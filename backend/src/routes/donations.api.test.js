"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/profileQueue", () => ({
  enqueueProfileUpdate: jest.fn(),
}));

jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const donationsRouter = require("./donations");

function buildApp() {
  const app = express();
  app.use(express.json());
  const io = { emit: jest.fn(), to: () => ({ emit: jest.fn() }) };
  app.set("io", io);
  app.use("/api/donations", donationsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}

function makeTxHash(char = "a") {
  return char.repeat(64);
}

const MOCK_DONATION_ROW = {
  id: "8d9ac19b-52eb-42f7-80d9-19a88ba59e43",
  project_id: "proj-1",
  donor_address: makePublicKey(),
  amount_xlm: "100.0000000",
  amount: "100.0000000",
  currency: "XLM",
  message: null,
  transaction_hash: makeTxHash(),
  created_at: new Date().toISOString(),
};

describe("GET /api/donations/:id", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns full donation for valid UUID", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          ...MOCK_DONATION_ROW,
          project_name: "Amazon Reforestation",
          donor_display_name: "John Doe",
          co2_offset_kg: "500",
        },
      ],
    });

    const res = await request(app)
      .get(`/api/donations/${MOCK_DONATION_ROW.id}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.projectName).toBe("Amazon Reforestation");
    expect(res.body.data.donorDisplayName).toBe("John Doe");
    expect(res.body.data.co2OffsetKg).toBe(500);
  });

  test("returns 404 if donation not found", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get(`/api/donations/${MOCK_DONATION_ROW.id}`)
      .expect(404);

    expect(res.body.error).toBe("Donation not found");
  });

  test("returns 400 for invalid UUID", async () => {
    const res = await request(app)
      .get("/api/donations/invalid-id")
      .expect(400);

    expect(res.body.error).toBe("Invalid donation ID");
  });
});
