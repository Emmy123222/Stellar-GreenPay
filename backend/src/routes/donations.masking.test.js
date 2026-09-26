/**
 * donations.masking.test.js
 * Tests for Issue #1090: Masking donor wallet addresses in public responses (PII protection)
 */
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
  del: jest.fn(),
  deletePattern: jest.fn(),
}));

jest.mock("../services/profileQueue", () => ({
  enqueueProfileUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn().mockResolvedValue(null),
  getProjectDonationEvents: jest.fn(),
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const { signToken } = require("../middleware/auth");
const donationsRouter = require("./donations");
const adminRouter = require("./admin");
const { maskWalletAddress } = require("./donations");

function buildApp() {
  const app = express();
  app.use(express.json());
  const io = { emit: jest.fn(), to: () => ({ emit: jest.fn() }) };
  app.set("io", io);
  app.use("/api/donations", donationsRouter);
  app.use("/api/admin", adminRouter);

  app.use((err, _req, res, next) => {
    void next;
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const DONOR_ALICE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const DONOR_BOB   = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

const MOCK_DONATIONS = [
  {
    id: "d0000000-0000-0000-0000-000000000001",
    project_id: "proj-1",
    donor_address: DONOR_ALICE,
    amount_xlm: "50.0000000",
    amount: "50",
    currency: "XLM",
    message: "Alice donation",
    transaction_hash: "a".repeat(64),
    created_at: new Date("2026-01-01T12:00:00Z").toISOString(),
    co2_per_xlm: 5000,
  },
  {
    id: "d0000000-0000-0000-0000-000000000002",
    project_id: "proj-1",
    donor_address: DONOR_BOB,
    amount_xlm: "100.0000000",
    amount: "100",
    currency: "XLM",
    message: "Bob donation",
    transaction_hash: "b".repeat(64),
    created_at: new Date("2026-01-02T12:00:00Z").toISOString(),
    co2_per_xlm: 5000,
  },
];

describe("maskWalletAddress utility", () => {
  it("truncates 56-character Stellar public keys to first 8 and last 4 chars", () => {
    const masked = maskWalletAddress(DONOR_ALICE);
    expect(masked).toBe("GAAAAAAA...AWHF");
    expect(masked.startsWith("GAAAAAAA")).toBe(true);
    expect(masked.endsWith("AWHF")).toBe(true);
    expect(masked.length).toBe(15);
  });

  it("handles short or empty strings gracefully", () => {
    expect(maskWalletAddress("")).toBe("");
    expect(maskWalletAddress(null)).toBeNull();
    expect(maskWalletAddress("SHORT")).toBe("SHORT");
    expect(maskWalletAddress("123456789012")).toBe("123456789012");
  });
});

describe("GET /api/donations — PII Wallet Masking (#1090)", () => {
  let app;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_API_KEY: "secret-admin-key", JWT_SECRET: "test-jwt-secret" };
    app = buildApp();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Public responses (unauthenticated)", () => {
    it("truncates donor_wallet and donorAddress to first 8 + last 4 characters", async () => {
      pool.query.mockResolvedValueOnce({ rows: MOCK_DONATIONS });

      const res = await request(app)
        .get("/api/donations?project_id=proj-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);

      const d1 = res.body.data[0];
      const d2 = res.body.data[1];

      // Alice's address masked
      expect(d1.donorAddress).toBe("GAAAAAAA...AWHF");
      expect(d1.donor_wallet).toBe("GAAAAAAA...AWHF");

      // Bob's address masked
      expect(d2.donorAddress).toBe("GBBBBBBB...BWHF");
      expect(d2.donor_wallet).toBe("GBBBBBBB...BWHF");
    });

    it("truncates donor address on /api/donations/project/:projectId", async () => {
      pool.query.mockResolvedValueOnce({ rows: MOCK_DONATIONS });

      const res = await request(app)
        .get("/api/donations/project/proj-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data[0].donorAddress).toBe("GAAAAAAA...AWHF");
      expect(res.body.data[0].donor_wallet).toBe("GAAAAAAA...AWHF");
    });
  });

  describe("Authenticated wallet owner (self-query)", () => {
    it("returns full unmasked address for the owner via X-Wallet-Address header", async () => {
      pool.query.mockResolvedValueOnce({ rows: MOCK_DONATIONS });

      const res = await request(app)
        .get("/api/donations?project_id=proj-1")
        .set("X-Wallet-Address", DONOR_ALICE)
        .expect(200);

      expect(res.body.success).toBe(true);
      const d1 = res.body.data[0]; // Alice
      const d2 = res.body.data[1]; // Bob

      // Alice is authenticated, so her donation has full unmasked address
      expect(d1.donorAddress).toBe(DONOR_ALICE);
      expect(d1.donor_wallet).toBe(DONOR_ALICE);

      // Bob is not authenticated, so his donation remains masked
      expect(d2.donorAddress).toBe("GBBBBBBB...BWHF");
      expect(d2.donor_wallet).toBe("GBBBBBBB...BWHF");
    });

    it("returns full unmasked address for the owner via Bearer JWT", async () => {
      pool.query.mockResolvedValueOnce({ rows: MOCK_DONATIONS });

      const token = signToken({ publicKey: DONOR_BOB }, "1h");

      const res = await request(app)
        .get("/api/donations?project_id=proj-1")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const d1 = res.body.data[0]; // Alice
      const d2 = res.body.data[1]; // Bob

      // Alice is masked
      expect(d1.donorAddress).toBe("GAAAAAAA...AWHF");

      // Bob is authenticated, so full address
      expect(d2.donorAddress).toBe(DONOR_BOB);
      expect(d2.donor_wallet).toBe(DONOR_BOB);
    });
  });

  describe("Admin access", () => {
    it("returns full unmasked addresses when using X-Admin-Key", async () => {
      pool.query.mockResolvedValueOnce({ rows: MOCK_DONATIONS });

      const res = await request(app)
        .get("/api/donations?project_id=proj-1")
        .set("X-Admin-Key", "secret-admin-key")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data[0].donorAddress).toBe(DONOR_ALICE);
      expect(res.body.data[0].donor_wallet).toBe(DONOR_ALICE);
      expect(res.body.data[1].donorAddress).toBe(DONOR_BOB);
      expect(res.body.data[1].donor_wallet).toBe(DONOR_BOB);
    });

    it("returns full unmasked addresses when using Admin Bearer JWT", async () => {
      pool.query.mockResolvedValueOnce({ rows: MOCK_DONATIONS });

      const adminToken = signToken({ role: "admin", sub: "admin" }, "1h");

      const res = await request(app)
        .get("/api/donations?project_id=proj-1")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data[0].donorAddress).toBe(DONOR_ALICE);
      expect(res.body.data[1].donorAddress).toBe(DONOR_BOB);
    });

    it("returns full unmasked addresses on GET /api/admin/donations", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: MOCK_DONATIONS }) // query
        .mockResolvedValueOnce({ rows: [{ total: "2" }] }); // countQuery

      const adminToken = signToken({ role: "admin", sub: "admin" }, "1h");

      const res = await request(app)
        .get("/api/admin/donations?projectId=proj-1")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data[0].donorAddress).toBe(DONOR_ALICE);
      expect(res.body.data[0].donor_wallet).toBe(DONOR_ALICE);
      expect(res.body.data[1].donorAddress).toBe(DONOR_BOB);
      expect(res.body.data[1].donor_wallet).toBe(DONOR_BOB);
      expect(res.body.total).toBe(2);
    });
  });
});
