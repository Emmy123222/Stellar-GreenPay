"use strict";

const request = require("supertest");
const express = require("express");
const { register } = require("../services/metrics");

function buildApp() {
  const app = express();
  async function metricsHandler(req, res) {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  }
  app.get("/metrics", metricsHandler);
  app.get("/api/metrics", metricsHandler);
  return app;
}

describe("GET /metrics", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  test("serves prometheus metrics with text content-type", async () => {
    const res = await request(app)
      .get("/metrics")
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("stats_refresh_failures_total");
  });

  test("serves prometheus metrics on /api/metrics alias", async () => {
    const res = await request(app)
      .get("/api/metrics")
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("stats_refresh_failures_total");
  });
});
