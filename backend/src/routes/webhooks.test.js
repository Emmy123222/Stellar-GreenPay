"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");
const webhooksRouter = require("./webhooks");

const OWNER_KEYPAIR = Keypair.random();
const OWNER_ADDRESS = OWNER_KEYPAIR.publicKey();
const OTHER_ADDRESS = Keypair.random().publicKey();
const PROJECT_ID = "proj-1";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks", webhooksRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("GET /api/webhooks/:projectId", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns configured webhook with masked secret for project owner", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "mock-webhook-value",
      }],
    });

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      projectId: PROJECT_ID,
      webhookUrl: "https://example.com/hook",
      webhookSecretMasked: "************alue",
      configured: true,
    });
  });

  test("returns null webhook fields when not configured", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: null,
        webhook_secret: null,
      }],
    });

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(200);

    expect(res.body.data).toEqual({
      projectId: PROJECT_ID,
      webhookUrl: null,
      webhookSecretMasked: null,
      configured: false,
    });
  });

  test("rejects requests without X-Wallet-Address", async () => {
    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .expect(401);

    expect(res.body.error).toBe("X-Wallet-Address header is required");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects invalid wallet addresses", async () => {
    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", "not-a-stellar-address")
      .expect(400);

    expect(res.body.error).toBe("X-Wallet-Address must be a valid Stellar address");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("returns 404 when project does not exist", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(404);

    expect(res.body.error).toBe("Project not found");
  });

  test("returns 403 when caller is not the project owner", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "mock",
      }],
    });

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OTHER_ADDRESS)
      .expect(403);

    expect(res.body.error).toBe("Only the project owner can view webhook configuration");
  });

  test("accepts signed challenge authentication", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "mockxx1234",
      }],
    });

    const challenge = `greenpay:webhook:list:${PROJECT_ID}`;
    const signature = OWNER_KEYPAIR.sign(Buffer.from(challenge, "utf8")).toString("base64");

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .set("X-Wallet-Challenge", challenge)
      .set("X-Wallet-Signature", signature)
      .expect(200);

    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.webhookSecretMasked).toBe("******1234");
  });

  test("rejects invalid signed challenge", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "mock",
      }],
    });

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .set("X-Wallet-Challenge", "tampered-challenge")
      .set("X-Wallet-Signature", OWNER_KEYPAIR.sign(Buffer.from("other", "utf8")).toString("base64"))
      .expect(403);

    expect(res.body.error).toBe("Only the project owner can view webhook configuration");
  });
});
