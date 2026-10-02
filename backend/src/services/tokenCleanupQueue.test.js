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

  test("removes stale tokens and logs count", async () => {
    pool.query.mockResolvedValue({
      rowCount: 5,
      rows: [
        { id: "1", token: "ExpoPushToken[aaa]", platform: "ios" },
        { id: "2", token: "ExpoPushToken[bbb]", platform: "android" },
        { id: "3", token: "ExpoPushToken[ccc]", platform: "ios" },
        { id: "4", token: "ExpoPushToken[ddd]", platform: "android" },
        { id: "5", token: "ExpoPushToken[eee]", platform: "ios" },
      ],
    });

    await runCleanup();

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM device_tokens")
    );
    expect(pool.query.mock.calls[0][0]).toContain("last_delivered_at IS NOT NULL");
    expect(pool.query.mock.calls[0][0]).toContain("90 days");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tokens_pruned", count: 5 }),
      expect.any(String)
    );
  });

  test("logs zero when no stale tokens found", async () => {
    pool.query.mockResolvedValue({ rowCount: 0, rows: [] });

    await runCleanup();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tokens_pruned", count: 0 }),
      expect.any(String)
    );
  });

  test("leaves recently-delivered tokens untouched", async () => {
    pool.query.mockResolvedValue({ rowCount: 0, rows: [] });

    await runCleanup();

    const query = pool.query.mock.calls[0][0];
    expect(query).toContain("last_delivered_at < NOW() - INTERVAL '90 days'");
    expect(query).toContain("last_delivered_at IS NOT NULL");
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
