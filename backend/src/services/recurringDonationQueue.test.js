/**
 * backend/src/services/recurringDonationQueue.test.js
 *
 * Unit tests for the per-pledge pg-boss job introduced for issue #1056:
 * cancelling a recurring donation must cancel the pg-boss job that was
 * scheduled against it, so the job no longer lives in the queue.
 */
"use strict";

jest.mock("pg-boss");
jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const {
  start,
  scheduleRecurringDonationJob,
  cancelRecurringDonationJob,
  PLEDGE_QUEUE,
} = require("./recurringDonationQueue");

describe("recurring donation pledge pg-boss job", () => {
  let bossInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    bossInstance = {
      on: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      schedule: jest.fn().mockResolvedValue(undefined),
      work: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue("pgboss-job-1"),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    PgBoss.mockImplementation(() => bossInstance);

    await start();
  });

  test("schedules exactly one singleton job keyed by the pledge id", async () => {
    const jobId = await scheduleRecurringDonationJob({
      pledgeId: "pledge-1",
      nextDueDate: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(jobId).toBe("pgboss-job-1");
    expect(bossInstance.send).toHaveBeenCalledTimes(1);
    const [queueName, data, options] = bossInstance.send.mock.calls[0];
    expect(queueName).toBe(PLEDGE_QUEUE);
    expect(data).toEqual({ pledgeId: "pledge-1" });
    expect(options.singletonKey).toBe("pledge-1");
  });

  // ── Acceptance criterion: cancel recurring donation → job no longer in queue ──
  test("cancelling a pledge cancels its pg-boss job", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "job-42" }] });

    const cancelled = await cancelRecurringDonationJob("pledge-1");

    expect(cancelled).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("pgboss.job"),
      [PLEDGE_QUEUE, "pledge-1"],
    );
    expect(bossInstance.cancel).toHaveBeenCalledWith(PLEDGE_QUEUE, "job-42");
  });

  test("is a no-op when the pledge has no job in the queue", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const cancelled = await cancelRecurringDonationJob("pledge-without-job");

    expect(cancelled).toBe(false);
    expect(bossInstance.cancel).not.toHaveBeenCalled();
  });
});
