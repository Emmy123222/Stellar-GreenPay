/**
 * backend/src/services/donationPushQueue.test.js
 *
 * Unit tests for the donation push notification pg-boss queue (issue #1543),
 * modelled on recurringDonationQueue.test.js, push.test.js and
 * tokenCleanupQueue.test.js.
 *
 * Covers: queue start/work registration, job enqueue, job consumption,
 * the Expo push payload shape, and failure handling — including cleanup of
 * invalid (DeviceNotRegistered) push tokens. pg-boss and the Expo SDK are
 * fully mocked, so no database or Expo connection is ever opened.
 */
"use strict";

const OLD_ENV = process.env;

afterEach(() => {
  process.env = OLD_ENV;
});

/**
 * A pg-boss instance double. `work` captures the registered handler so tests
 * can consume jobs exactly the way the queue worker would.
 *
 * @returns {object} pg-boss mock instance
 */
function makeBoss() {
  return {
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue("pgboss-job-1"),
  };
}

/**
 * Register the module mocks shared by every test in this file.
 *
 * @param {object} bossInstance - pg-boss instance returned by the constructor
 */
function mockQueueDeps(bossInstance) {
  jest.doMock("pg-boss", () => jest.fn(() => bossInstance));
  jest.doMock("../logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
  jest.doMock("@sentry/node", () => ({ captureException: jest.fn() }));
}

describe("donationPushQueue queue lifecycle and enqueue", () => {
  let queue;
  let bossInstance;
  let PgBoss;
  let logger;
  let Sentry;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.DATABASE_URL;

    bossInstance = makeBoss();
    mockQueueDeps(bossInstance);

    PgBoss = require("pg-boss");
    logger = require("../logger");
    Sentry = require("@sentry/node");
    queue = require("./donationPushQueue");
  });

  test("exports the queue name and its public API", () => {
    expect(queue.QUEUE).toBe("donation-push-notification");
    expect(typeof queue.start).toBe("function");
    expect(typeof queue.enqueueDonationPushNotification).toBe("function");
  });

  test("start() registers a worker on the donation push queue", async () => {
    process.env.DATABASE_URL = "postgres://tester:secret@db:5432/test";

    await queue.start();

    expect(PgBoss).toHaveBeenCalledWith(
      "postgres://tester:secret@db:5432/test",
    );
    expect(bossInstance.start).toHaveBeenCalledTimes(1);
    expect(bossInstance.work).toHaveBeenCalledWith(
      "donation-push-notification",
      { teamSize: 2, teamConcurrency: 1 },
      expect.any(Function),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "donation_push_queue_started" }),
      expect.any(String),
    );
  });

  test("start() falls back to the default connection string", async () => {
    await queue.start();

    expect(PgBoss).toHaveBeenCalledWith(
      "postgres://postgres:postgres@localhost:5432/greenpay",
    );
  });

  test("start() is idempotent — one pg-boss instance and one worker", async () => {
    await queue.start();
    await queue.start();

    expect(PgBoss).toHaveBeenCalledTimes(1);
    expect(bossInstance.start).toHaveBeenCalledTimes(1);
    expect(bossInstance.work).toHaveBeenCalledTimes(1);
  });

  test("forwards pg-boss error events to the logger", async () => {
    await queue.start();

    const errorHandler = bossInstance.on.mock.calls.find(
      (call) => call[0] === "error",
    )[1];
    errorHandler(new Error("connection terminated"));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "donation_push_pgboss_error" }),
      "connection terminated",
    );
  });

  test("enqueue before start() skips the job and warns", async () => {
    const jobId = await queue.enqueueDonationPushNotification({
      projectId: "42",
    });

    expect(jobId).toBeNull();
    expect(bossInstance.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "donation_push_queue_not_started" }),
      expect.any(String),
    );
  });

  test("enqueue sends the job payload to the queue and returns its id", async () => {
    await queue.start();
    const data = {
      projectId: "42",
      projectName: "Solar for Schools",
      amountXLM: "25",
      donorBadge: "Gold",
    };

    const jobId = await queue.enqueueDonationPushNotification(data);

    expect(jobId).toBe("pgboss-job-1");
    expect(bossInstance.send).toHaveBeenCalledTimes(1);
    expect(bossInstance.send).toHaveBeenCalledWith(
      "donation-push-notification",
      data,
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "donation_push_enqueued",
        projectId: "42",
        jobId: "pgboss-job-1",
      }),
      expect.any(String),
    );
  });

  test("enqueue failure is logged, reported to Sentry and swallowed", async () => {
    await queue.start();
    bossInstance.send.mockRejectedValue(new Error("pg down"));

    const jobId = await queue.enqueueDonationPushNotification({
      projectId: "42",
      projectName: "Solar for Schools",
      amountXLM: "25",
      donorBadge: "Gold",
    });

    expect(jobId).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "donation_push_enqueue_error" }),
      expect.stringContaining("pg down"),
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          projectId: "42",
          queue: "donation-push-notification",
        }),
      }),
    );
  });
});

describe("donationPushQueue job consumption (pg-boss + Expo mocked)", () => {
  let queue;
  let bossInstance;
  let mockExpo;
  let pool;
  let logger;
  let Sentry;
  let worker;

  const jobData = {
    projectId: "42",
    projectName: "Solar for Schools",
    amountXLM: "25",
    donorBadge: "Gold",
  };

  beforeEach(async () => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.DATABASE_URL;

    bossInstance = makeBoss();
    mockExpo = {
      isExpoPushToken: jest.fn(() => true),
      chunkPushNotifications: jest.fn((msgs) => [msgs]),
      sendPushNotificationsAsync: jest.fn().mockResolvedValue([
        { status: "ok" },
      ]),
      chunkPushNotificationReceipts: jest.fn((ids) => [ids]),
      getPushNotificationReceiptsAsync: jest.fn(),
    };

    mockQueueDeps(bossInstance);
    jest.doMock("../db/pool", () => ({ query: jest.fn() }));
    jest.doMock("expo-server-sdk", () => ({
      Expo: Object.assign(jest.fn(() => mockExpo), {
        isExpoPushToken: mockExpo.isExpoPushToken,
      }),
    }));

    pool = require("../db/pool");
    logger = require("../logger");
    Sentry = require("@sentry/node");
    queue = require("./donationPushQueue");

    await queue.start();
    worker = bossInstance.work.mock.calls[0][2];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * @param {object} [overrides] - fields overriding the default job data
   * @returns {object} pg-boss job passed to the registered worker
   */
  function makeJob(overrides = {}) {
    return { id: "job-1", data: { ...jobData, ...overrides } };
  }

  test("consumes a job and sends the Expo push payload", async () => {
    pool.query.mockResolvedValue({
      rows: [{ token: "ExpoPushToken[aaa]", platform: "ios" }],
    });

    await worker(makeJob());

    // Admin device tokens are looked up by the project's wallet address.
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM device_tokens dt"),
      ["42"],
    );

    const sent = mockExpo.sendPushNotificationsAsync.mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      to: "ExpoPushToken[aaa]",
      sound: "default",
      title: "New Donation to Solar for Schools",
      body: "Gold donor donated 25 XLM to your project.",
      data: {
        projectId: "42",
        type: "new_donation",
        amountXLM: "25",
        donorBadge: "Gold",
      },
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "donation_push_processed",
        projectId: "42",
        jobId: "job-1",
      }),
      expect.any(String),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test("payload falls back to 'Someone' when the donor has no badge", async () => {
    pool.query.mockResolvedValue({
      rows: [{ token: "ExpoPushToken[aaa]" }],
    });

    await worker(makeJob({ amountXLM: "10", donorBadge: "" }));

    const sent = mockExpo.sendPushNotificationsAsync.mock.calls[0][0];
    expect(sent[0].body).toBe("Someone donated 10 XLM to your project.");
    expect(sent[0].data).toEqual({
      projectId: "42",
      type: "new_donation",
      amountXLM: "10",
      donorBadge: "",
    });
  });

  test("skips invalid Expo push tokens", async () => {
    mockExpo.isExpoPushToken.mockImplementation(
      (token) => token === "ExpoPushToken[valid]",
    );
    pool.query.mockResolvedValue({
      rows: [{ token: "not-a-token" }, { token: "ExpoPushToken[valid]" }],
    });

    await worker(makeJob());

    const sent = mockExpo.sendPushNotificationsAsync.mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ExpoPushToken[valid]");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "push_invalid_token" }),
      expect.any(String),
    );
  });

  test("does not send when the project admin has no devices", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await worker(makeJob());

    expect(mockExpo.sendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "push_no_admin_tokens" }),
      expect.any(String),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  // ── Acceptance criterion: push token invalid → token cleanup path ──
  test("deletes the device token when Expo reports DeviceNotRegistered", async () => {
    pool.query.mockResolvedValue({
      rows: [{ token: "ExpoPushToken[dead]" }],
    });
    mockExpo.sendPushNotificationsAsync.mockResolvedValue([
      { id: "ticket-1", status: "error", message: "DeviceNotRegistered" },
    ]);

    // Cleanup is not a job failure: the job completes so pg-boss retries nothing.
    await expect(worker(makeJob())).resolves.toBeUndefined();

    expect(pool.query).toHaveBeenCalledWith(
      "DELETE FROM device_tokens WHERE token = $1",
      ["ExpoPushToken[dead]"],
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "push_token_removed" }),
      expect.any(String),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test("marks delivery when Expo returns an ok receipt", async () => {
    jest.useFakeTimers();
    pool.query.mockResolvedValue({
      rows: [{ token: "ExpoPushToken[aaa]" }],
    });
    mockExpo.sendPushNotificationsAsync.mockResolvedValue([
      { id: "ticket-1", status: "ok" },
    ]);
    mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
    });

    const workerPromise = worker(makeJob());
    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(3000);
    }
    await workerPromise;

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE device_tokens SET last_delivered_at"),
      ["ExpoPushToken[aaa]"],
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test("re-throws push failures so pg-boss retries, and reports to Sentry", async () => {
    pool.query.mockRejectedValue(new Error("db down"));

    await expect(worker(makeJob())).rejects.toThrow("db down");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "donation_push_error",
        projectId: "42",
        jobId: "job-1",
      }),
      expect.stringContaining("db down"),
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "db down" }),
      expect.objectContaining({
        tags: expect.objectContaining({
          projectId: "42",
          queue: "donation-push-notification",
        }),
        extra: expect.objectContaining({
          projectName: "Solar for Schools",
          amountXLM: "25",
          donorBadge: "Gold",
        }),
      }),
    );
    // No token cleanup on transport failure — only fatal Expo tickets prune.
    expect(pool.query).not.toHaveBeenCalledWith(
      "DELETE FROM device_tokens WHERE token = $1",
      expect.anything(),
    );
  });

  test("fails the job when the Expo SDK rejects", async () => {
    pool.query.mockResolvedValue({
      rows: [{ token: "ExpoPushToken[aaa]" }],
    });
    mockExpo.sendPushNotificationsAsync.mockRejectedValue(
      new Error("Expo unreachable"),
    );

    await expect(worker(makeJob())).rejects.toThrow("Expo unreachable");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "donation_push_error" }),
      expect.stringContaining("Expo unreachable"),
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
