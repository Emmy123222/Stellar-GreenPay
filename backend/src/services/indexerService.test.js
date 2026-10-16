/**
 * indexerService.test.js
 * Unit tests for indexerService deactivation and recurring donation cancellation
 */
"use strict";

jest.mock("../logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("indexerService - ProjectDeactivated", () => {
  let indexerService;
  let mockPool;
  let mockClient;
  let mockEmail;
  let mockStellar;
  let mockStreamOptions;
  let mockLedgerCall;

  beforeEach(() => {
    jest.resetModules();

    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
    };

    mockEmail = {
      sendRecurringDonationCancelledEmail: jest.fn().mockResolvedValue(undefined),
    };
    mockStreamOptions = null;
    mockLedgerCall = jest.fn().mockResolvedValue({
      records: [{ sequence: "100" }],
    });

    mockStellar = {
      server: {
        operations: jest.fn(() => ({
          cursor: jest.fn(() => ({
            stream: jest.fn((options) => {
              mockStreamOptions = options;
              return jest.fn();
            }),
          })),
        })),
        ledgers: jest.fn(() => {
          const query = {
            order: jest.fn(),
            limit: jest.fn(),
            call: mockLedgerCall,
          };
          query.order.mockReturnValue(query);
          query.limit.mockReturnValue(query);
          return query;
        }),
      },
      getProjectDeactivatedEvents: jest.fn().mockResolvedValue([]),
    };

    jest.doMock("../db/pool", () => mockPool);
    jest.doMock("./email", () => mockEmail);
    jest.doMock("./store", () => ({ computeBadges: jest.fn(() => []) }));
    jest.doMock("./webhook", () => ({ checkAndDeliverMilestones: jest.fn() }));
    jest.doMock("./donationEvents", () => ({ emit: jest.fn() }));
    jest.doMock("./stellar", () => mockStellar);

    indexerService = require("./indexerService");
  });

  afterEach(() => {
    indexerService.stopIndexer();
  });

  describe("getHealth", () => {
    it("reports the stopped indexer without making a Horizon request", async () => {
      await expect(indexerService.getHealth()).resolves.toMatchObject({
        status: "unavailable",
        isRunning: false,
        currentLedger: null,
        lagLedgers: null,
      });
      expect(mockStellar.server.ledgers).not.toHaveBeenCalled();
    });

    it("calculates ledger lag and shares the cached latest-ledger probe", async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await indexerService.startIndexer({ emit: jest.fn() });
      await mockStreamOptions.onmessage({ ledger_attr: 95, type: "other" });

      const first = await indexerService.getHealth();
      await mockStreamOptions.onmessage({ ledger_attr: 99, type: "other" });
      const second = await indexerService.getHealth();

      expect(first).toMatchObject({
        status: "ok",
        isRunning: true,
        lastProcessedLedger: 95,
        currentLedger: 100,
        lagLedgers: 5,
      });
      expect(second).toMatchObject({ lastProcessedLedger: 99, lagLedgers: 1 });
      expect(mockStellar.server.ledgers).toHaveBeenCalledTimes(1);
    });

    it("returns a degraded, non-sensitive result when Horizon is unavailable", async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      mockLedgerCall.mockRejectedValueOnce(new Error("private endpoint details"));
      await indexerService.startIndexer({ emit: jest.fn() });

      const result = await indexerService.getHealth();

      expect(result).toMatchObject({
        status: "degraded",
        currentLedger: null,
        lagLedgers: null,
      });
      expect(JSON.stringify(result)).not.toContain("private endpoint details");
    });
  });

  describe("handleProjectDeactivated", () => {
    it("cancels recurring donations and notifies donors via email", async () => {
      const projectId = "proj-uuid-123";

      // 1. SELECT active recurring donations
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: "rd-1",
            donor_address: "GDONOR11111111111111111111111111111111111111111111111111",
            project_name: "Clean Ocean Project",
          },
          {
            id: "rd-2",
            donor_address: "GDONOR22222222222222222222222222222222222222222222222222",
            project_name: "Clean Ocean Project",
          },
        ],
      });

      // 2. BEGIN
      mockClient.query.mockResolvedValueOnce({});

      // 3. UPDATE recurring_donations
      mockClient.query.mockResolvedValueOnce({ rowCount: 2 });

      // 4. COMMIT
      mockClient.query.mockResolvedValueOnce({});

      // 5. Look up donor 1 email in project_subscriptions
      mockPool.query.mockResolvedValueOnce({
        rows: [{ email: "donor1@example.com" }],
      });

      // 6. Look up donor 2 email in project_subscriptions
      mockPool.query.mockResolvedValueOnce({
        rows: [{ email: "donor2@example.com" }],
      });

      const result = await indexerService.handleProjectDeactivated(projectId);

      expect(result).toEqual({ cancelledCount: 2 });
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();

      // Check email notifications
      expect(mockEmail.sendRecurringDonationCancelledEmail).toHaveBeenCalledTimes(2);
      expect(mockEmail.sendRecurringDonationCancelledEmail).toHaveBeenCalledWith({
        email: "donor1@example.com",
        projectName: "Clean Ocean Project",
        donationId: "rd-1",
      });
      expect(mockEmail.sendRecurringDonationCancelledEmail).toHaveBeenCalledWith({
        email: "donor2@example.com",
        projectName: "Clean Ocean Project",
        donationId: "rd-2",
      });
    });

    it("handles project with no recurring donations gracefully", async () => {
      const projectId = "proj-empty";

      // 1. SELECT returns no rows
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // 2. BEGIN
      mockClient.query.mockResolvedValueOnce({});
      // 3. UPDATE
      mockClient.query.mockResolvedValueOnce({ rowCount: 0 });
      // 4. COMMIT
      mockClient.query.mockResolvedValueOnce({});

      const result = await indexerService.handleProjectDeactivated(projectId);

      expect(result).toEqual({ cancelledCount: 0 });
      expect(mockEmail.sendRecurringDonationCancelledEmail).not.toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("rolls back transaction on error", async () => {
      const projectId = "proj-error";

      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: "rd-1", donor_address: "GABC", project_name: "Fail Project" }],
      });
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockRejectedValueOnce(new Error("DB update failed")); // primary UPDATE error
      mockClient.query.mockRejectedValueOnce(new Error("DB update failed")); // fallback UPDATE error
      mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

      await expect(indexerService.handleProjectDeactivated(projectId)).rejects.toThrow("DB update failed");
      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe("pollDeactivationEvents", () => {
    it("fetches contract events and triggers deactivation handling", async () => {
      mockStellar.getProjectDeactivatedEvents.mockResolvedValueOnce([
        { projectId: "proj-event-1", ledger: 100 },
        { projectId: "proj-event-2", ledger: 101 },
      ]);

      // Mock handleProjectDeactivated dependencies for each event
      mockClient.query.mockResolvedValue({ rows: [] });

      await indexerService.pollDeactivationEvents();

      expect(mockStellar.getProjectDeactivatedEvents).toHaveBeenCalled();
      // Should query for donations for each event
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT rd.id, rd.donor_address"),
        ["proj-event-1"]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT rd.id, rd.donor_address"),
        ["proj-event-2"]
      );
    });
  });
});

describe("indexer Horizon stream recovery", () => {
  let mockStream;
  let indexer;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    mockStream = jest.fn().mockReturnValue(jest.fn());
    jest.doMock("../db/pool", () => ({
      query: jest.fn().mockResolvedValue({ rows: [] }),
    }));
    jest.doMock("./stellar", () => ({
      server: {
        operations: () => ({ cursor: () => ({ stream: mockStream }) }),
      },
      getProjectDeactivatedEvents: jest.fn().mockResolvedValue([]),
    }));
    jest.doMock("./email", () => ({ sendRecurringDonationCancelledEmail: jest.fn() }));
    jest.doMock("./store", () => ({ computeBadges: jest.fn(() => []) }));
    jest.doMock("./webhook", () => ({ checkAndDeliverMilestones: jest.fn() }));
    jest.doMock("./donationEvents", () => ({ emit: jest.fn() }));
    indexer = require("./indexerService");
  });

  afterEach(() => {
    indexer.stopIndexer();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("backs off after an authorization error instead of reconnecting immediately", async () => {
    await indexer.startIndexer({ emit: jest.fn() });
    const handlers = mockStream.mock.calls[0][0];

    handlers.onerror({ status: 401, message: "unauthorized" });
    expect(mockStream).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(900);
    expect(mockStream).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(500);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });
});
