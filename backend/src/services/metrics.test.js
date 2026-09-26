/**
 * src/services/metrics.test.js
 * Tests for the Prometheus registry used by the leaderboard instrumentation
 * added for issue #1093.
 */
"use strict";

const { register, leaderboardQueryDuration, metricsHandler } = require("./metrics");

describe("metrics service (issue #1093)", () => {
  test("exposes the leaderboard query histogram", async () => {
    const metric = await register.getSingleMetricAsString("greenpay_leaderboard_query_duration_seconds");

    expect(metric).toContain("# TYPE greenpay_leaderboard_query_duration_seconds histogram");
    expect(metric).toContain("# HELP greenpay_leaderboard_query_duration_seconds");
  });

  test("writes observations into the configured period/sort_by labels", async () => {
    leaderboardQueryDuration.observe({ period: "month", sort_by: "impact_score" }, 0.25);

    const text = await register.metrics();
    expect(text).toContain("period=\"month\"");
    expect(text).toContain("sort_by=\"impact_score\"");
    // Bucket counts only move once an observation lands, so a labelled _count
    // line is the proof the sample was recorded.
    expect(text).toMatch(/greenpay_leaderboard_query_duration_seconds_count\{period="month",sort_by="impact_score"\} 1/);
  });

  test("serves the registry in Prometheus text format", async () => {
    let body = "";
    const res = {
      set: jest.fn(),
      end: (payload) => {
        body = payload;
      },
    };

    await metricsHandler({}, res);

    expect(res.set).toHaveBeenCalledWith(
      "Content-Type",
      expect.stringContaining("text/plain"),
    );
    expect(body).toContain("greenpay_leaderboard_query_duration_seconds");
  });
});
