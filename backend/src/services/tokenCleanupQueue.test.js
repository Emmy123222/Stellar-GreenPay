"use strict";

const OLD_ENV = process.env;

afterEach(() => {
  process.env = OLD_ENV;
});

describe("runCleanup", () => {
  let runCleanup;
  let pool;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };

    jest.doMock("../db/pool", () => ({ query: jest.fn() }));
    jest.doMock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

    pool = require("../db/pool");
    logger = require("../logger");
    const queue = require("./tokenCleanupQueue");
    runCleanup = queue.runCleanup;
  });

  test("removes stale tokens and logs total count", async () => {
    // Single batch — rowCount < BATCH_SIZE so the loop exits after one iteration.
    pool.query.mockResolvedValue({ rowCount: 5 });

    await runCleanup();

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("DELETE FROM device_tokens");
    expect(sql).toContain("last_delivered_at IS NOT NULL");
    expect(sql).toContain("90 days");
    expect(sql).toContain("LIMIT $1");
    expect(params).toEqual([1000]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tokens_pruned", count: 5 }),
      expect.any(String)
    );
  });

  test("loops until a batch returns fewer than BATCH_SIZE rows", async () => {
    // Simulate two full batches (1000 each) then a partial batch that ends the loop.
    pool.query
      .mockResolvedValueOnce({ rowCount: 1000 })
      .mockResolvedValueOnce({ rowCount: 1000 })
      .mockResolvedValueOnce({ rowCount: 42 });

    await runCleanup();

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tokens_pruned", count: 2042 }),
      expect.any(String)
    );
  });

  test("logs zero when no stale tokens found", async () => {
    pool.query.mockResolvedValue({ rowCount: 0 });

    await runCleanup();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tokens_pruned", count: 0 }),
      expect.any(String)
    );
  });

  test("leaves recently-delivered tokens untouched (query shape)", async () => {
    pool.query.mockResolvedValue({ rowCount: 0 });

    await runCleanup();

    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain("last_delivered_at < NOW() - INTERVAL '90 days'");
    expect(sql).toContain("last_delivered_at IS NOT NULL");
  });

  test("logs error on query failure", async () => {
    pool.query.mockRejectedValue(new Error("connection refused"));

    await runCleanup();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "token_cleanup_error" }),
      "connection refused"
    );
  });
});

describe("start", () => {
  let start;
  let mockBoss;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };

    mockBoss = {
      on: jest.fn(),
      start: jest.fn(),
      schedule: jest.fn(),
      work: jest.fn(),
    };

    function MockPgBoss() {
      return mockBoss;
    }
    jest.doMock("pg-boss", () => MockPgBoss);
    jest.doMock("../db/pool", () => ({ query: jest.fn() }));
    jest.doMock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

    start = require("./tokenCleanupQueue").start;
  });

  test("disables via env var", async () => {
    process.env.TOKEN_CLEANUP_CRON = "disabled";

    await start();

    expect(mockBoss.start).not.toHaveBeenCalled();
    expect(mockBoss.schedule).not.toHaveBeenCalled();
    expect(mockBoss.work).not.toHaveBeenCalled();
  });

  test("uses custom cron from env", async () => {
    process.env.TOKEN_CLEANUP_CRON = "0 4 * * *";

    await start();

    expect(mockBoss.schedule).toHaveBeenCalledWith(
      "device-token-cleanup",
      "0 4 * * *",
      {},
      { tz: "UTC" }
    );
  });

  test("registers worker with teamSize 1", async () => {
    delete process.env.TOKEN_CLEANUP_CRON;

    await start();

    expect(mockBoss.work).toHaveBeenCalledWith(
      "device-token-cleanup",
      { teamSize: 1, teamConcurrency: 1 },
      expect.any(Function)
    );
  });
});
