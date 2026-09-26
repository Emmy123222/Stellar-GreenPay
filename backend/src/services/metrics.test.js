"use strict";

describe("metrics service", () => {
  let metrics;

  beforeEach(() => {
    metrics = require("./metrics");
  });

  test("initializes Prometheus counter stats_refresh_failures_total", () => {
    expect(metrics.statsRefreshFailuresTotal).toBeDefined();
    expect(typeof metrics.statsRefreshFailuresTotal.inc).toBe("function");
    expect(metrics.register).toBeDefined();
  });

  test("can increment counter without error", () => {
    expect(() => {
      metrics.statsRefreshFailuresTotal.inc({
        queue: "refresh-global-stats-mv",
        reason: "test_failure",
      });
    }).not.toThrow();
  });

  test("register returns metric string output", async () => {
    const output = await metrics.register.metrics();
    expect(output).toContain("stats_refresh_failures_total");
  });
});

describe("leaderboard query histogram (issue #1093)", () => {
  const { register, leaderboardQueryDuration } = require("./metrics");

  test("exposes the leaderboard query histogram", async () => {
    const metric = await register.getSingleMetricAsString(
      "greenpay_leaderboard_query_duration_seconds",
    );

    expect(metric).toContain("# TYPE greenpay_leaderboard_query_duration_seconds histogram");
    expect(metric).toContain("# HELP greenpay_leaderboard_query_duration_seconds");
  });

  test("writes observations into the configured period/sort_by labels", async () => {
    leaderboardQueryDuration.observe({ period: "month", sort_by: "impact_score" }, 0.25);

    const text = await register.metrics();
    expect(text).toContain('period="month"');
    expect(text).toContain('sort_by="impact_score"');
    // Bucket counts only move once an observation lands, so a labelled _count
    // line is the proof the sample was recorded.
    expect(text).toMatch(
      /greenpay_leaderboard_query_duration_seconds_count\{period="month",sort_by="impact_score"\} 1/,
    );
  });
});
