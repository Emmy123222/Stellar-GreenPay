"use strict";

// The exported server app requires ESM-only native/queue dependencies and the
// route modules built on them. Mock the heavy services and routers (the same
// pattern used by profiles.test.js) so requiring ../server stays a CommonJS
// load; the selective-CSRF middleware under test is registered before any of
// those routers, so its behaviour is unaffected by the pass-through mocks.
jest.mock("../db/pool", () => ({ query: jest.fn() }));
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
// The admin router (and its pg-boss dependency) is not part of these tests.
jest.mock("../routes/admin", () => mockPassThroughRouter);

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { isCsrfExempt } = require("../middleware/selectiveCsrf");

describe("CSRF protection", () => {
  const agent = request.agent(app);

  it("returns a CSRF token from GET /api/v1/csrf-token", async () => {
    const res = await agent.get("/api/v1/csrf-token").expect(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true }));
    expect(typeof res.body.csrfToken).toBe("string");
    expect(res.body.csrfToken.length).toBeGreaterThan(0);
    expect(res.headers["content-security-policy"]).toBe("default-src 'none';frame-ancestors 'none'");
  });

  it("rejects mutating requests without an X-CSRF-Token header", async () => {
    const res = await agent
      .post("/api/v1/ratings")
      .send({ projectId: "project-1", donorAddress: "GA123456789012345678901234567890123456789012345678901234", rating: 5 })
      .expect(403);

    expect(res.body.error.toLowerCase()).toContain("csrf");
  });

  it("allows mutating requests when a valid X-CSRF-Token header is provided", async () => {
    const tokenResponse = await agent.get("/api/v1/csrf-token").expect(200);
    const token = tokenResponse.body.csrfToken;

    const res = await agent
      .post("/api/v1/ratings")
      .set("X-CSRF-Token", token)
      .send({ projectId: "project-1", donorAddress: "GA123456789012345678901234567890123456789012345678901234", rating: 5 });

    expect(res.status).not.toBe(403);
  });
});

describe("CSRF path exemptions", () => {
  // Unit coverage for every path the removed csrfProtection block used to list.
  it.each([
    ["/health", true],
    ["/api/health", true],
    ["/api/v1/health", true],
    ["/api/readiness", true],
    ["/metrics", true],
    ["/api/metrics", true],
    ["/api/notifications", true],
    ["/api/v1/notifications", true],
    ["/api/mobile/donations", true],
    ["/api/extension/donations", true],
    ["/api/donations", false],
    ["/api/v1/projects", false],
  ])("isCsrfExempt(%s) === %s", (pathname, expected) => {
    expect(isCsrfExempt(pathname)).toBe(expected);
  });

  // Each path is exercised with a mutating method so the exemption can only
  // come from the path list, not from the GET/HEAD/OPTIONS ignoreMethods rule.
  it.each([
    "/api/notifications",
    "/api/v1/notifications",
    "/api/health",
    "/api/v1/health",
    "/api/readiness",
    "/metrics",
    "/api/metrics",
  ])("does not challenge a mutating request to the exempt path %s", async (pathname) => {
    const res = await request(app).post(pathname);

    expect(res.status).not.toBe(403);
  });

  it("still challenges a mutating request to a protected route", async () => {
    const res = await request(app).post("/api/v1/donations");

    expect(res.status).toBe(403);
    expect(res.body.error.toLowerCase()).toContain("csrf");
  });
});

describe("server CSRF wiring", () => {
  it("does not reference the removed csrfProtection helper", () => {
    const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

    expect(serverSource).not.toMatch(/csrfProtection/);
    expect(serverSource).toMatch(/createSelectiveCsrf/);
  });
});
