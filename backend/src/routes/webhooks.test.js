"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));
jest.mock("../services/webhook", () => ({
  deliverPayload: jest.fn(),
}));

// Mount tests below exercise the exported server app (#1531). Mock the heavy
// services (the same set used by csrf.test.js / admin.test.js) so requiring
// ../server stays a CommonJS load; the webhooks router itself is left
// untouched and exercised through the real /api/webhooks mount points.
jest.mock("../services/sentry", () => ({
  initSentry: jest.fn(),
  errorHandler: () => (err, _req, _res, next) => next(err),
}));
jest.mock("../services/profileQueue", () => ({
  start: jest.fn(),
  enqueueAvatarProcessing: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/summaryQueue", () => ({ start: jest.fn() }));
jest.mock("../services/statsRefreshQueue", () => ({ start: jest.fn() }));
jest.mock("../services/indexerService", () => ({ startIndexer: jest.fn() }));
jest.mock("../services/socketHandler", () => ({ registerSocketHandlers: jest.fn() }));
jest.mock("../db/migrate", () => ({ runMigrations: jest.fn() }));
jest.mock("../services/turrets", () => ({ startTurretsServer: jest.fn() }));
jest.mock("../services/stellar", () => ({
  isStellarTimeoutError: jest.fn(() => false),
  server: {},
}));
jest.mock("../services/metrics", () => ({
  metricsHandler: (_req, res) => res.end(),
  countRequest: jest.fn(),
  startQueueRefresh: jest.fn(),
}));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

// Every non-webhooks router is replaced by a pass-through so the exported app
// can be loaded without its pg-boss/ESM queue dependencies.
const mockPassThroughRouter = (_req, _res, next) => next();
jest.mock("../routes/projects", () => mockPassThroughRouter);
jest.mock("../routes/uploads", () => mockPassThroughRouter);
jest.mock("../routes/donations", () => mockPassThroughRouter);
jest.mock("../routes/stats", () => mockPassThroughRouter);
jest.mock("../routes/health", () => mockPassThroughRouter);
jest.mock("../routes/readiness", () => mockPassThroughRouter);
jest.mock("../routes/impact", () => mockPassThroughRouter);
jest.mock("../routes/subscriptions", () => mockPassThroughRouter);
jest.mock("../routes/referrals", () => mockPassThroughRouter);
jest.mock("../routes/recurringDonations", () => mockPassThroughRouter);
jest.mock("../routes/auth", () => mockPassThroughRouter);
jest.mock("../routes/ratings", () => mockPassThroughRouter);
jest.mock("../routes/teams", () => mockPassThroughRouter);
jest.mock("../routes/admin", () => mockPassThroughRouter);

const express = require("express");
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");
const { deliverPayload } = require("../services/webhook");
const webhooksRouter = require("./webhooks");
const serverApp = require("../server");

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
    // Keypair.sign() returns a Uint8Array under stellar-sdk 17; wrap it in a
    // Buffer so toString("base64") produces real base64 (not comma-joined bytes).
    const signature = Buffer.from(OWNER_KEYPAIR.sign(Buffer.from(challenge, "utf8"))).toString("base64");

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
      .set("X-Wallet-Signature", Buffer.from(OWNER_KEYPAIR.sign(Buffer.from("other", "utf8"))).toString("base64"))
      .expect(403);

    expect(res.body.error).toBe("Only the project owner can view webhook configuration");
  });
});

describe("GET /api/webhooks/:projectId/history", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns paginated delivery history for project owner", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: PROJECT_ID,
          wallet_address: OWNER_ADDRESS,
          webhook_url: "https://example.com/hook",
          webhook_secret: "secret",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "del-1",
          project_id: PROJECT_ID,
          event: "milestone.reached",
          payload_hash: "abc123",
          status: "delivered",
          attempt_count: 1,
          last_attempt_at: "2026-07-01T12:00:00.000Z",
          next_attempt_at: null,
          response_status: 200,
          last_error: null,
          delivered_at: "2026-07-01T12:00:00.000Z",
          created_at: "2026-07-01T12:00:00.000Z",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}/history?page=1&pageSize=20`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: [{
        id: "del-1",
        projectId: PROJECT_ID,
        event: "milestone.reached",
        payloadHash: "abc123",
        status: "delivered",
        attempts: 1,
        lastAttemptAt: "2026-07-01T12:00:00.000Z",
        nextAttemptAt: null,
        responseStatus: 200,
        lastError: null,
        deliveredAt: "2026-07-01T12:00:00.000Z",
        createdAt: "2026-07-01T12:00:00.000Z",
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  test("rejects non-owners from viewing history", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "secret",
      }],
    });

    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}/history`)
      .set("X-Wallet-Address", OTHER_ADDRESS)
      .expect(403);

    expect(res.body.error).toBe("Only the project owner can view webhook configuration");
  });

  test("rejects requests without X-Wallet-Address", async () => {
    const res = await request(app)
      .get(`/api/webhooks/${PROJECT_ID}/history`)
      .expect(401);

    expect(res.body.error).toBe("X-Wallet-Address header is required");
  });
});

describe("PATCH /api/webhooks/:projectId/test", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("sends a signed test event for the configured project", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "test-secret",
      }],
    });
    deliverPayload.mockResolvedValue({ statusCode: 202 });

    const res = await request(app)
      .patch(`/api/webhooks/${PROJECT_ID}/test`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(200);

    expect(res.body).toEqual({ success: true, responseStatus: 202 });
    expect(deliverPayload).toHaveBeenCalledWith(
      "https://example.com/hook",
      "test-secret",
      expect.objectContaining({ event: "webhook.test", projectId: PROJECT_ID }),
    );
  });

  test("rejects an unconfigured webhook", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: null,
        webhook_secret: null,
      }],
    });

    const res = await request(app)
      .patch(`/api/webhooks/${PROJECT_ID}/test`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(400);

    expect(res.body.error).toBe("Webhook is not configured for this project");
    expect(deliverPayload).not.toHaveBeenCalled();
  });

  test("returns 502 when the webhook endpoint responds unsuccessfully", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "test-secret",
      }],
    });
    deliverPayload.mockResolvedValue({ statusCode: 500 });

    const res = await request(app)
      .patch(`/api/webhooks/${PROJECT_ID}/test`)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(502);

    expect(res.body.responseStatus).toBe(500);
  });
});

describe("Webhooks router mounts on the exported app (#1531)", () => {
  const agent = request.agent(serverApp);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("reaches the webhooks router at /api/webhooks (401, not the 404 handler)", async () => {
    const res = await request(serverApp).get(`/api/webhooks/${PROJECT_ID}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("X-Wallet-Address header is required");
  });

  test("reaches the webhooks router at /api/v1/webhooks (401, not the 404 handler)", async () => {
    const res = await request(serverApp).get(`/api/v1/webhooks/${PROJECT_ID}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("X-Wallet-Address header is required");
  });

  test("serves the webhook configuration through both prefixes", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "mock-webhook-value",
      }],
    });

    const legacy = await request(serverApp)
      .get(`/api/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OWNER_ADDRESS);
    const versioned = await request(serverApp)
      .get(`/api/v1/webhooks/${PROJECT_ID}`)
      .set("X-Wallet-Address", OWNER_ADDRESS);

    expect(legacy.status).toBe(200);
    expect(versioned.status).toBe(200);
    expect(legacy.body.data.webhookUrl).toBe("https://example.com/hook");
    expect(versioned.body.data.configured).toBe(true);
  });

  test("serves the delivery history through both prefixes", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: PROJECT_ID,
          wallet_address: OWNER_ADDRESS,
          webhook_url: "https://example.com/hook",
          webhook_secret: "secret",
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    const legacy = await request(serverApp)
      .get(`/api/webhooks/${PROJECT_ID}/history`)
      .set("X-Wallet-Address", OWNER_ADDRESS);
    const versioned = await request(serverApp)
      .get(`/api/v1/webhooks/${PROJECT_ID}/history`)
      .set("X-Wallet-Address", OWNER_ADDRESS);

    expect(legacy.status).toBe(200);
    expect(versioned.status).toBe(200);
    expect(legacy.body).toEqual(expect.objectContaining({ success: true, total: 0 }));
    expect(versioned.body).toEqual(expect.objectContaining({ success: true, total: 0 }));
  });

  test("delivers a test event through /api/v1/webhooks behind the CSRF middleware", async () => {
    const tokenResponse = await agent.get("/api/v1/csrf-token").expect(200);

    pool.query.mockResolvedValue({
      rows: [{
        id: PROJECT_ID,
        wallet_address: OWNER_ADDRESS,
        webhook_url: "https://example.com/hook",
        webhook_secret: "test-secret",
      }],
    });
    deliverPayload.mockResolvedValue({ statusCode: 202 });

    const res = await agent
      .patch(`/api/v1/webhooks/${PROJECT_ID}/test`)
      .set("X-CSRF-Token", tokenResponse.body.csrfToken)
      .set("X-Wallet-Address", OWNER_ADDRESS)
      .expect(200);

    expect(res.body).toEqual({ success: true, responseStatus: 202 });
    expect(deliverPayload).toHaveBeenCalledWith(
      "https://example.com/hook",
      "test-secret",
      expect.objectContaining({ event: "webhook.test", projectId: PROJECT_ID }),
    );
  });

  test("still 404s paths that do not match a webhook route", async () => {
    const res = await request(serverApp).get("/api/webhooks");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("GET /api/webhooks not found");
  });
});
