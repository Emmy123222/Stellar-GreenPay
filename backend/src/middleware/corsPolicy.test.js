"use strict";

const express = require("express");
const request = require("supertest");
const { createCorsMiddleware, getAllowedOrigins } = require("./corsPolicy");

function buildApp(allowedOrigins = ["https://greenpay.app", "http://localhost:3000"]) {
  const app = express();
  app.use(...createCorsMiddleware(allowedOrigins));
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("CORS policy", () => {
  test("rejects a random origin with 403 and no CORS headers", async () => {
    const res = await request(buildApp())
      .get("/health")
      .set("Origin", "https://evil.com");

    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("rejects a random preflight origin with 403 and no CORS headers", async () => {
    const res = await request(buildApp())
      .options("/health")
      .set("Origin", "https://evil.com")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("allows a configured production origin without credentials", async () => {
    const res = await request(buildApp())
      .get("/health")
      .set("Origin", "https://greenpay.app");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://greenpay.app");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("uses only configured origins when ALLOWED_ORIGINS is provided", () => {
    expect(getAllowedOrigins("https://app.example.com, http://localhost:3000")).toEqual([
      "https://app.example.com",
      "http://localhost:3000",
    ]);
  });

  test("defaults to production and local development origins", () => {
    expect(getAllowedOrigins("")).toEqual(
      expect.arrayContaining([
        "https://greenpay.app",
        "https://www.greenpay.app",
        "https://stellar-greenpay.app",
        "https://www.stellar-greenpay.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ]),
    );
  });
  test("allows requests without an Origin header", async () => {
    const res = await request(buildApp())
      .get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("allows a configured origin for preflight OPTIONS request", async () => {
    const res = await request(buildApp())
      .options("/health")
      .set("Origin", "https://greenpay.app")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://greenpay.app");
    expect(res.headers["access-control-allow-methods"]).toBe("GET,POST,PATCH");
  });
});
