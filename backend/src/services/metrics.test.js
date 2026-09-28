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
