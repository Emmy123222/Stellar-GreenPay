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

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/profileQueue", () => ({
  enqueueProfileUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn().mockResolvedValue(null),
  getProjectDonationEvents: jest.fn(),
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const donationsRouter = require("./donations");
const projectsRouter = require("./projects");

function buildApp() {
  const app = express();
  app.use(express.json());
  const io = { emit: jest.fn(), to: () => ({ emit: jest.fn() }) };
  app.set("io", io);
  app.use("/api/donations", donationsRouter);
  app.use("/api/projects", projectsRouter);


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

function queryResult(rows = []) {
  return { rows };
}

function createMockClient(...responses) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };

  responses.forEach((response) => {
    if (response instanceof Error) {
      client.query.mockRejectedValueOnce(response);
      return;
    }

    client.query.mockResolvedValueOnce(response);
  });

  pool.connect.mockResolvedValue(client);
  return client;
}

const MOCK_PROJECT_ROW = {
  id: "proj-1",
  name: "Test Project",
  description: "A test climate project",
  category: "Reforestation",
  location: "Brazil",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  goal_xlm: "10000",
  raised_xlm: "5000",
  donor_count: 42,
  co2_offset_kg: 50000,
  status: "active",
  verified: true,
  on_chain_verified: false,
  tags: ["reforestation", "amazon"],
  created_at: new Date().toISOString(),
};

const MOCK_DONATION_ROW = {
  id: "8d9ac19b-52eb-42f7-80d9-19a88ba59e43",
  project_id: "proj-1",
  donor_address: makePublicKey(),
  amount_xlm: "100.0000000",
  amount: "100",
  currency: "XLM",
  message: "Great project!",
  transaction_hash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
  created_at: new Date().toISOString(),
};

describe("POST /api/donations", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("records a valid donation", async () => {
    const donorAddress = makePublicKey("A");
    const transactionHash = makeTxHash("a");
    const donationRow = {
      ...MOCK_DONATION_ROW,
      donor_address: donorAddress,
      transaction_hash: transactionHash,
    };

    createMockClient(
      queryResult([{ id: "proj-1" }]),
      queryResult([]),
      queryResult(),
      queryResult([donationRow]),
      queryResult([]),
      queryResult(),
      queryResult(),
    );

    const res = await request(app)
      .post("/api/donations")
      .send({
        projectId: "proj-1",
        donorAddress,
        amountXLM: 100,
        currency: "XLM",
        message: "Great project!",
        transactionHash,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.projectId).toBe("proj-1");
    expect(res.body.data.donorAddress).toBe(donorAddress);
  });
});

describe("GET /api/projects/:id", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    redis.get.mockResolvedValue(null);
    jest.clearAllMocks();
  });

  test("returns a single project", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_PROJECT_ROW, follow_count: 3 }],
    });
    pool.query.mockResolvedValueOnce({ rows: [] }); // campaigns
    pool.query.mockResolvedValueOnce({ rows: [{ avg_rating: "4.5", count: "10" }] }); // ratings
    pool.query.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // subscribers
    pool.query.mockResolvedValueOnce({ rows: [] }); // milestones

    const res = await request(app).get("/api/projects/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Test Project");
    expect(res.body.data.followCount).toBe(3);
  });

  test("returns 404 for non-existent project", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/projects/nonexistent").expect(404);
  });
});

describe("GET /api/projects/:id/on-chain-donations", () => {
  let app;
  const stellarService = require("../services/stellar");

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns decoded on-chain donation events", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "proj-1" }] });
    stellarService.getProjectDonationEvents.mockResolvedValueOnce([
      {
        donor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        amount: "100000000",
        ledger: 1234,
        badge: "Seedling",
        msgHash: 987654,
        pagingToken: "1234-1",
      },
    ]);

    const res = await request(app)
      .get("/api/projects/proj-1/on-chain-donations?limit=10")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      {
        donor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        amount: "100000000",
        ledger: 1234,
        badge: "Seedling",
        msgHash: 987654,
      },
    ]);
    expect(res.body.nextCursor).toBe("1234-1");
  });

  test("returns 404 if project does not exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get("/api/projects/unknown/on-chain-donations")
      .expect(404);
  });
});

describe("POST /api/projects (admin)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/projects/admin/register")
      .send({ name: "Test" });

    expect(res.status).toBe(401);
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
