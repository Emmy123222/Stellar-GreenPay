/**
 * digestQueue.test.js
 * Unit tests for digestQueue, particularly unsubscribe filtering
 */
"use strict";

jest.mock("../db/pool");
jest.mock("pg-boss");
jest.mock("../services/unsubscribeToken");

const pool = require("../db/pool");
const { runDigest } = require("./digestQueue");

describe("digestQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe("runDigest - unsubscribed user filtering", () => {
    it("should not send digest to unsubscribed users", async () => {
      const projectId = "proj-123";
      const projectName = "Solar Forest";

      // Mock project query
      pool.query.mockResolvedValueOnce({
        rows: [{ id: projectId, name: projectName, co2_offset_kg: 100 }],
      });

      // Mock stats query
      pool.query.mockResolvedValueOnce({
        rows: [{ raised_xlm: 50.5, donation_count: 2 }],
      });

      // Mock lifetime total query
      pool.query.mockResolvedValueOnce({
        rows: [{ total: 100 }],
      });

      // Mock milestones query
      pool.query.mockResolvedValueOnce({
        rows: [{ title: "50% funded", percentage: 50 }],
      });

      // Mock updates query
      pool.query.mockResolvedValueOnce({
        rows: [{ title: "Progress update", body: "We've planted 1000 trees" }],
      });

      // Mock subscriber query - only active subscriptions (unsubscribed = false)
      pool.query.mockResolvedValueOnce({
        rows: [{ email: "alice@example.com" }, { email: "bob@example.com" }],
      });

      // Verify the query filters correctly
      await runDigest();

      // Find the call that fetches subscribers
      const subscriberCall = pool.query.mock.calls.find(
        (call) =>
          call[0].includes("project_subscriptions") &&
          call[0].includes("unsubscribed = false OR unsubscribed IS NULL"),
      );

      expect(subscriberCall).toBeDefined();
      expect(subscriberCall[1]).toEqual([projectId]);
    });
  });
});
