"use strict";
/**
 * middleware/rateLimiter.test.js
 * Integration tests for the express-rate-limit donation limiter.
 *
 * Spins up a minimal Express app with the *real* createRateLimiter (limit=10,
 * window=1 min) — no mocks — then fires requests in sequence and asserts that:
 *   - Requests 1-10 receive HTTP 200.
 *   - Request 11 receives HTTP 429.
 *   - The 429 response includes a `Retry-After` header.
 *
 * The rate-limit store is reset between test suites by creating a fresh app
 * instance for each describe block.
 */

const express = require("express");
const request = require("supertest");
const { createRateLimiter } = require("./rateLimiter");

/** Build a minimal app that applies the given limiter to GET /ping. */
function buildApp(maxRequests = 10, windowMinutes = 1) {
  const app = express();
  const limiter = createRateLimiter(maxRequests, windowMinutes);
  app.use(limiter);
  app.get("/ping", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("Rate limiting middleware — donation endpoint", () => {
  let app;

  beforeEach(() => {
    // Fresh app → fresh in-memory store → counters reset to 0
    app = buildApp(10, 1);
  });

  it("allows up to 10 requests within the time window", async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await request(app).get("/ping");
      expect(res.status).toBe(200);
    }
  });

  it("blocks the 11th request with HTTP 429", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).get("/ping");
    }

    const res = await request(app).get("/ping");
    expect(res.status).toBe(429);
  });

  it("returns a Retry-After header on the 429 response", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).get("/ping");
    }

    const res = await request(app).get("/ping");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("returns a JSON body with a human-readable message on 429", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).get("/ping");
    }

    const res = await request(app).get("/ping");
    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty("message");
    expect(typeof res.body.message).toBe("string");
  });

  it("still blocks request 12 after the 11th was already rejected", async () => {
    for (let i = 0; i < 12; i++) {
      await request(app).get("/ping");
    }

    const res = await request(app).get("/ping");
    expect(res.status).toBe(429);
  });
});

describe("Rate limiting middleware — custom window", () => {
  it("resets independent counters for separate app instances", async () => {
    const appA = buildApp(2, 1);
    const appB = buildApp(2, 1);

    // Exhaust appA
    await request(appA).get("/ping");
    await request(appA).get("/ping");
    const blockedOnA = await request(appA).get("/ping");
    expect(blockedOnA.status).toBe(429);

    // appB counter is untouched — first request must succeed
    const okOnB = await request(appB).get("/ping");
    expect(okOnB.status).toBe(200);
  });
});

describe("Rate limiting middleware — custom limits", () => {
  it("enforces a custom limit of 3 requests", async () => {
    const customApp = buildApp(3, 1);

    for (let i = 0; i < 3; i++) {
      const res = await request(customApp).get("/ping");
      expect(res.status).toBe(200);
    }

    const res = await request(customApp).get("/ping");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
