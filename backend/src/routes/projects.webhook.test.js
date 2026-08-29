"use strict";

/**
 * Tests for #794 — webhook secret minimum length validation (≥ 32 chars).
 *
 * Covers the PATCH /api/projects/:id/webhook endpoint added to projects.js.
 */

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../services/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
  deletePattern: jest.fn(),
}));
jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn(),
  getProjectDonationEvents: jest.fn(),
  CONTRACT_ID: "test-contract",
  server: { getTransaction: jest.fn() },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));
jest.mock("../services/summaryQueue", () => ({ enqueueAISummary: jest.fn() }));
jest.mock("../services/audit", () => ({ logAdminAction: jest.fn() }));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");

process.env.ADMIN_API_KEY = "test-admin-key";

const projectsRouter = require("./projects");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const VALID_SECRET = "a".repeat(32);
const VALID_URL    = "https://hooks.example.com/greenpay";

function authHeader() {
  return { "X-Admin-Key": process.env.ADMIN_API_KEY };
}

describe("PATCH /api/projects/:id/webhook (#794)", () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: project exists
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: PROJECT_ID }] })   // SELECT for existence
      .mockResolvedValueOnce({ rows: [{ id: PROJECT_ID, webhook_url: VALID_URL }] }); // UPDATE RETURNING
  });

  test("accepts a valid webhookUrl + 32-char secret", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/webhook`)
      .set(authHeader())
      .send({ webhookUrl: VALID_URL, webhookSecret: VALID_SECRET });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("accepts a secret longer than 32 characters", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/webhook`)
      .set(authHeader())
      .send({ webhookUrl: VALID_URL, webhookSecret: "b".repeat(64) });
    expect(res.status).toBe(200);
  });

  test("rejects a secret shorter than 32 characters", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/webhook`)
      .set(authHeader())
      .send({ webhookUrl: VALID_URL, webhookSecret: "tooshort" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/webhookSecret must be at least 32/i);
  });

  test("rejects a secret exactly 31 characters long", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/webhook`)
      .set(authHeader())
      .send({ webhookUrl: VALID_URL, webhookSecret: "x".repeat(31) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/webhookSecret must be at least 32/i);
  });

  test("rejects non-https webhook URL", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/webhook`)
      .set(authHeader())
      .send({ webhookUrl: "http://insecure.example.com/hook", webhookSecret: VALID_SECRET });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/webhookUrl must be a valid https/i);
  });

  test("clears webhook when both fields are null", async () => {
    const res = await request(app)
      .patch(`/api/projects/${PROJECT_ID}/webhook`)
      .set(authHeader())
      .send({ webhookUrl: null, webhookSecret: null });
    expect(res.status).toBe(200);
  });

  test("returns 404 for unknown project id", async () => {
    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({ rows: [] }); // project not found
    const unknownId = "99999999-9999-9999-9999-999999999999";
    const res = await request(app)
      .patch(`/api/projects/${unknownId}/webhook`)
      .set(authHeader())
      .send({ webhookUrl: VALID_URL, webhookSecret: VALID_SECRET });
    expect(res.status).toBe(404);
  });
});

describe("webhook.js delivery guard — skips short secrets (#794)", () => {
  test("does not deliver when stored secret is shorter than 32 chars", async () => {
    const { checkAndDeliverMilestones } = require("../services/webhook");

    pool.query.mockReset();
    // Project row with a short secret
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: PROJECT_ID,
        goal_xlm: "1000",
        raised_xlm: "500",
        webhook_url: VALID_URL,
        webhook_secret: "weak",
      }],
    });
    // No unreached milestones
    pool.query.mockResolvedValueOnce({ rows: [] });

    const deliverSpy = jest.spyOn(require("https"), "request").mockImplementation(() => ({
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    }));

    await checkAndDeliverMilestones(PROJECT_ID);
    expect(deliverSpy).not.toHaveBeenCalled();
    deliverSpy.mockRestore();
  });
});
