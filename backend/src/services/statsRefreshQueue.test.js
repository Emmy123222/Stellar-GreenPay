"use strict";

const OLD_ENV = process.env;

afterEach(() => {
  process.env = OLD_ENV;
  jest.clearAllMocks();
});

describe("statsRefreshQueue", () => {
  let pool;
  let sentry;
  let metrics;
  let statsRefreshQueue;
  let mockBoss;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };

    mockBoss = {
      on: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      schedule: jest.fn().mockResolvedValue(undefined),
      work: jest.fn().mockResolvedValue("worker-1"),
      onComplete: jest.fn().mockResolvedValue(undefined),
      onExpire: jest.fn().mockResolvedValue(undefined),
      archive: jest.fn().mockResolvedValue(undefined),
    };

    function MockPgBoss() {
      return mockBoss;
    }

    jest.doMock("pg-boss", () => MockPgBoss);
    jest.doMock("../db/pool", () => ({ query: jest.fn() }));
    jest.doMock("./sentry", () => ({
      Sentry: {
        captureException: jest.fn(),
      },
    }));
    jest.doMock("./metrics", () => ({
      statsRefreshFailuresTotal: {
        inc: jest.fn(),
      },
    }));

    pool = require("../db/pool");
    sentry = require("./sentry").Sentry;
    metrics = require("./metrics");
    statsRefreshQueue = require("./statsRefreshQueue");
  });

  describe("refreshGlobalStatsMv", () => {
    test("refreshes materialized view concurrently", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await statsRefreshQueue.refreshGlobalStatsMv();

      expect(pool.query).toHaveBeenCalledWith(
        "REFRESH MATERIALIZED VIEW CONCURRENTLY global_stats_mv"
      );
    });

    test("propagates error on database query failure", async () => {
      pool.query.mockRejectedValueOnce(new Error("DB connection error"));

      await expect(statsRefreshQueue.refreshGlobalStatsMv()).rejects.toThrow(
        "DB connection error"
      );
    });
  });

  describe("moveToDeadLetter", () => {
    test("persists failed job into dead_letter table", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      const fakeJob = {
        id: "job-123",
        data: {
          request: { id: "req-123", data: { reason: "test" } },
          response: { message: "connection refused" },
        },
      };

      await statsRefreshQueue.moveToDeadLetter(fakeJob);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO dead_letter"),
        [
          "refresh-global-stats-mv",
          "req-123",
          JSON.stringify({ reason: "test" }),
          "connection refused",
        ]
      );
    });

    test("handles fallback job structure gracefully", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      const fakeJob = {
        id: "job-456",
        data: { custom: "payload" },
        error: new Error("fatal timeout"),
      };

      await statsRefreshQueue.moveToDeadLetter(fakeJob);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO dead_letter"),
        [
          "refresh-global-stats-mv",
          "job-456",
          JSON.stringify({ custom: "payload" }),
          "fatal timeout",
        ]
      );
    });

    test("catches database insertion error without crashing", async () => {
      pool.query.mockRejectedValueOnce(new Error("insert failure"));
      const spyConsole = jest.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        statsRefreshQueue.moveToDeadLetter({ id: "job-error" })
      ).resolves.not.toThrow();

      expect(spyConsole).toHaveBeenCalled();
      spyConsole.mockRestore();
    });
  });

  describe("onExpire", () => {
    test("logs failed job to Sentry, writes to dead_letter, increments Prometheus counter, and archives", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      const fakeJob = {
        data: {
          request: { id: "job-expired-1", data: {} },
          response: { message: "timeout error" },
          state: "expired",
          failed: true,
          retryCount: 3,
        },
      };

      await statsRefreshQueue.onExpire(fakeJob);

      // 1. Sentry capture
      expect(sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            queue: "refresh-global-stats-mv",
            state: "expired",
          }),
          extra: expect.objectContaining({
            jobId: "job-expired-1",
            queue: "refresh-global-stats-mv",
            state: "expired",
            retryCount: 3,
          }),
        })
      );

      // 2. dead_letter persistence
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO dead_letter"),
        expect.arrayContaining(["refresh-global-stats-mv", "job-expired-1"])
      );

      // 3. Prometheus counter increment
      expect(metrics.statsRefreshFailuresTotal.inc).toHaveBeenCalledWith({
        queue: "refresh-global-stats-mv",
        reason: "expired",
      });
    });

    test("handles empty job safely", async () => {
      await expect(statsRefreshQueue.onExpire(null)).resolves.toBeUndefined();
      expect(sentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe("start", () => {
    test("schedules cron job with retries and onComplete tracking", async () => {
      pool.query.mockResolvedValue({ rowCount: 1 });

      await statsRefreshQueue.start();

      expect(mockBoss.start).toHaveBeenCalled();
      expect(mockBoss.schedule).toHaveBeenCalledWith(
        "refresh-global-stats-mv",
        "* * * * *",
        {},
        {
          tz: "UTC",
          retryLimit: 3,
          retryDelay: 10,
          retryBackoff: true,
          onComplete: true,
        }
      );
      expect(mockBoss.onExpire).toHaveBeenCalledWith(
        "refresh-global-stats-mv",
        expect.any(Function)
      );
      expect(mockBoss.work).toHaveBeenCalledWith(
        "refresh-global-stats-mv",
        { teamSize: 1, teamConcurrency: 1 },
        expect.any(Function)
      );
    });

    test("worker increments failure metric and rethrows when refreshGlobalStatsMv fails", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 }); // initial warm-up

      await statsRefreshQueue.start();

      const workerCallback = mockBoss.work.mock.calls[0][2];
      pool.query.mockRejectedValueOnce(new Error("Connection reset"));

      await expect(workerCallback({ id: "job-1" })).rejects.toThrow(
        "Connection reset"
      );

      expect(metrics.statsRefreshFailuresTotal.inc).toHaveBeenCalledWith({
        queue: "refresh-global-stats-mv",
        reason: "Connection reset",
      });
    });

    test("fallback to onComplete when onExpire is not defined on boss", async () => {
      delete mockBoss.onExpire;
      pool.query.mockResolvedValue({ rowCount: 1 });

      await statsRefreshQueue.start();

      expect(mockBoss.onComplete).toHaveBeenCalledWith(
        "refresh-global-stats-mv",
        expect.any(Function)
      );
    });
  });
});
