"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const donationsRouter = require("./donations");

function buildApp() {
  const app = express();
  app.use(express.json());

  const io = { to: () => ({ emit: jest.fn() }) };
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

function makeTxHash() {
  return "a".repeat(64);
}

function createMockClient(...responses) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  responses.forEach((response) => {
    if (response instanceof Error) {
      client.query.mockRejectedValueOnce(response);
    } else {
      client.query.mockResolvedValueOnce(response);
    }
  });
  pool.connect.mockResolvedValue(client);
  return client;
}

const MOCK_PROJECT = { id: "proj-1", name: "Test Project" };
const MOCK_DONATION_ROW = {
  id: "don-1",
  project_id: "proj-1",
  donor_address: makePublicKey(),
  amount_xlm: 100,
  amount: 100,
  currency: "XLM",
  message: "Great project!",
  transaction_hash: makeTxHash(),
  created_at: new Date().toISOString(),
};

describe("POST /api/donations", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("records a valid donation", async () => {
    createMockClient(
      { rows: [MOCK_PROJECT] },
      { rows: [] },
      { rows: [MOCK_DONATION_ROW] },
      { rows: [] },
      { rows: [] },
      undefined,
      { rows: [{ ...MOCK_DONATION_ROW, total_donated_xlm: 100 }] },
      { rows: [] },
    );

    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: makePublicKey(),
        amountXLM: 100,
        currency: "XLM",
        message: "Great project!",
        transactionHash: makeTxHash(),
      })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test("rejects invalid donor address", async () => {
    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: "invalid",
        amountXLM: 100,
        transactionHash: makeTxHash(),
      })
      .expect(400);

    expect(res.body.error).toContain("Invalid Stellar public key");
  });

  test("rejects invalid transaction hash", async () => {
    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: makePublicKey(),
        amountXLM: 100,
        transactionHash: "invalid",
      })
      .expect(400);

    expect(res.body.error).toContain("Invalid transaction hash");
  });

  test("rejects HTML in donation messages with 422 field errors", async () => {
    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: makePublicKey(),
        amountXLM: 100,
        message: "<script>alert('x')</script>",
        transactionHash: makeTxHash(),
      })
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.message).toBeDefined();
  });

  test("returns 404 for unknown project", async () => {
    createMockClient({ rows: [] });

    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "nonexistent",
        donorAddress: makePublicKey(),
        amountXLM: 100,
        transactionHash: makeTxHash(),
      })
      .expect(404);

    expect(res.body.error).toContain("Project not found");
  });

  test("deduplicates by transaction hash", async () => {
    createMockClient({ rows: [MOCK_PROJECT] }, { rows: [MOCK_DONATION_ROW] });

    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: makePublicKey(),
        amountXLM: 100,
        transactionHash: makeTxHash(),
      })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test("rejects zero amount", async () => {
    createMockClient({ rows: [MOCK_PROJECT] });

    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: makePublicKey(),
        amountXLM: 0,
        transactionHash: makeTxHash(),
      })
      .expect(400);

    expect(res.body.error).toContain("Invalid amount");
  });

  test("rejects negative amount", async () => {
    createMockClient({ rows: [MOCK_PROJECT] });

    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress: makePublicKey(),
        amountXLM: -50,
        transactionHash: makeTxHash(),
      })
      .expect(400);

    expect(res.body.error).toContain("Invalid amount");
  });
});

describe("GET /api/donations/project/:projectId", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns donations for a project", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_DONATION_ROW] });

    const res = await request(app)
      .get("/api/donations/project/proj-1")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("returns empty array for project with no donations", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get("/api/donations/project/proj-1")
      .expect(200);

    expect(res.body.data).toEqual([]);
  });
});

describe("GET /api/donations/donor/:publicKey", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns donations for a donor", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_DONATION_ROW] });

    const res = await request(app)
      .get(`/api/donations/donor/${makePublicKey()}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test("rejects invalid donor key", async () => {
    await request(app)
      .get("/api/donations/donor/invalid")
      .expect(400);
  });
});

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

    const validId = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
    const res = await request(app)
      .get(`/api/donations/${validId}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.projectName).toBe("Amazon Reforestation");
    expect(res.body.data.donorDisplayName).toBe("John Doe");
    expect(res.body.data.co2OffsetKg).toBe(500);
  });

  test("returns 404 if donation not found", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const validId = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
    const res = await request(app)
      .get(`/api/donations/${validId}`)
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
