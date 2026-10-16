"use strict";

jest.mock("../services/turrets", () => ({ startTurretsServer: jest.fn() }));
jest.mock("../services/stellar", () => ({
  isStellarTimeoutError: jest.fn(() => false),
  server: {},
}));
jest.mock("../services/sentry", () => ({
  initSentry: jest.fn(),
  errorHandler: () => (err, _req, _res, next) => next(err),
}));
jest.mock("../services/summaryQueue", () => ({ start: jest.fn() }));
jest.mock("../services/profileQueue", () => ({ start: jest.fn() }));
jest.mock("../services/statsRefreshQueue", () => ({ start: jest.fn() }));
jest.mock("../services/indexerService", () => ({
  startIndexer: jest.fn(),
  getStatus: () => ({ status: "ok", lastIndexedLedger: 100 }),
}));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../db/migrate", () => ({ runMigrations: jest.fn() }));
jest.mock("../db/pool", () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
}));

const mockPassThroughRouter = (_req, _res, next) => next();
jest.mock("../routes/projects", () => mockPassThroughRouter);
jest.mock("../routes/uploads", () => mockPassThroughRouter);
jest.mock("../routes/donations", () => mockPassThroughRouter);
jest.mock("../routes/stats", () => mockPassThroughRouter);
jest.mock("../routes/readiness", () => mockPassThroughRouter);
jest.mock("../routes/impact", () => mockPassThroughRouter);
jest.mock("../routes/subscriptions", () => mockPassThroughRouter);
jest.mock("../routes/referrals", () => mockPassThroughRouter);
jest.mock("../routes/recurringDonations", () => mockPassThroughRouter);
jest.mock("../routes/auth", () => mockPassThroughRouter);
jest.mock("../routes/ratings", () => mockPassThroughRouter);
jest.mock("../routes/teams", () => mockPassThroughRouter);

const request = require("supertest");
const app = require("../server");

describe("Content Security Policy (CSP)", () => {
  it("asserts strict CSP header on JSON endpoints", async () => {
    const res = await request(app).get("/api/v1/csrf-token").expect(200);

    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none';frame-ancestors 'none'"
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("asserts strict CSP header on /health endpoint", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none';frame-ancestors 'none'"
    );
  });

  it("asserts relaxed CSP header on /api/docs and renders Swagger UI in development", async () => {
    const res = await request(app).get("/api/docs/").expect(200);

    expect(res.headers["content-type"]).toMatch(/text\/html/);
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");

    // Verify Swagger UI HTML renders
    expect(res.text).toContain("Swagger UI");
    expect(res.text).toContain("swagger-ui");
  });

  it("asserts relaxed CSP header on Swagger UI assets", async () => {
    const res = await request(app).get("/api/docs/swagger-ui.css").expect(200);

    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("asserts strict CSP header when NODE_ENV is production", async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const res = await request(app).get("/health").expect(200);
      expect(res.headers["content-security-policy"]).toBe(
        "default-src 'none';frame-ancestors 'none'"
      );
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
