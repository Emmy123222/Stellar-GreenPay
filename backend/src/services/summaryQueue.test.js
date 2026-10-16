"use strict";

const OLD_ENV = process.env;

afterEach(() => {
  process.env = OLD_ENV;
  jest.clearAllMocks();
});

describe("summaryQueue", () => {
  let pool;
  let claude;
  let audit;
  let summaryQueue;
  let mockBoss;
  let PgBossCtor;
  let handler;

  const jobData = {
    projectId: "project-1",
    name: "Solar Forest",
    category: "Reforestation",
    description: "Planting trees",
    adminAddress: "GADMIN",
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.DATABASE_URL;

    mockBoss = {
      on: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      work: jest.fn().mockResolvedValue("worker-1"),
      send: jest.fn().mockResolvedValue("job-1"),
    };

    PgBossCtor = jest.fn(function MockPgBoss() {
      return mockBoss;
    });

    jest.doMock("pg-boss", () => PgBossCtor);
    jest.doMock("../db/pool", () => ({ query: jest.fn() }));
    jest.doMock("./claude", () => ({ generateProjectSummary: jest.fn() }));
    jest.doMock("./audit", () => ({ logAdminAction: jest.fn() }));

    pool = require("../db/pool");
    claude = require("./claude");
    audit = require("./audit");
    summaryQueue = require("./summaryQueue");

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function startAndGetHandler(io) {
    await summaryQueue.start(io);
    handler = mockBoss.work.mock.calls[0][2];
    return handler;
  }

  describe("registration", () => {
    test("starts pg-boss and registers the ai-summary worker with expected options", async () => {
      await summaryQueue.start({});

      expect(PgBossCtor).toHaveBeenCalledWith(
        "postgres://postgres:postgres@localhost:5432/greenpay"
      );
      expect(mockBoss.start).toHaveBeenCalledTimes(1);
      expect(mockBoss.work).toHaveBeenCalledWith(
        "ai-summary",
        { teamSize: 2, teamConcurrency: 1 },
        expect.any(Function)
      );
    });

    test("uses DATABASE_URL when set and logs pg-boss errors", async () => {
      process.env.DATABASE_URL = "postgres://user:pw@db:5432/custom";
      await summaryQueue.start({});

      expect(PgBossCtor).toHaveBeenCalledWith("postgres://user:pw@db:5432/custom");
      const [event, onError] = mockBoss.on.mock.calls[0];
      expect(event).toBe("error");
      onError(new Error("boom"));
      expect(console.error).toHaveBeenCalledWith("[summaryQueue] pg-boss error:", "boom");
    });
  });

  describe("enqueueAISummary", () => {
    test("throws if called before start", async () => {
      await expect(summaryQueue.enqueueAISummary("p1", {})).rejects.toThrow(
        "summaryQueue not started"
      );
    });

    test("sends job with retry options and singleton key", async () => {
      await summaryQueue.start({});
      const id = await summaryQueue.enqueueAISummary("project-1", {
        name: "Solar Forest",
        category: "Reforestation",
        description: "Planting trees",
      });

      expect(id).toBe("job-1");
      expect(mockBoss.send).toHaveBeenCalledWith(
        "ai-summary",
        expect.objectContaining({ projectId: "project-1", name: "Solar Forest" }),
        { retryLimit: 3, retryDelay: 10, singletonKey: "summary-project-1" }
      );
    });

    test("skips a duplicate while a job for the project is active", async () => {
      await summaryQueue.start({});
      await summaryQueue.enqueueAISummary("project-1", {});
      const second = await summaryQueue.enqueueAISummary("project-1", {});

      expect(second).toBeNull();
      expect(mockBoss.send).toHaveBeenCalledTimes(1);
    });

    test("releases the dedupe slot when boss.send fails", async () => {
      await summaryQueue.start({});
      mockBoss.send.mockRejectedValueOnce(new Error("db down"));

      await expect(summaryQueue.enqueueAISummary("project-1", {})).rejects.toThrow("db down");
      await expect(summaryQueue.enqueueAISummary("project-1", {})).resolves.toBe("job-1");
    });

    test("applies a 5-minute cooldown after a successful run", async () => {
      const io = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
      await startAndGetHandler(io);
      claude.generateProjectSummary.mockResolvedValue({ summary: "S", model: "m" });
      pool.query.mockResolvedValue({
        rows: [{ ai_summary: "S", ai_summary_generated_at: new Date(), ai_summary_model: "m" }],
      });

      await handler({ data: jobData });
      const result = await summaryQueue.enqueueAISummary("project-1", {});

      expect(result).toBeNull();
      expect(mockBoss.send).not.toHaveBeenCalled();
    });
  });

  describe("job handler", () => {
    test("happy path: generates summary, writes to DB, emits to project room, audits", async () => {
      const emit = jest.fn();
      const io = { to: jest.fn().mockReturnValue({ emit }) };
      await startAndGetHandler(io);

      const generatedAt = new Date("2026-01-01T00:00:00Z");
      claude.generateProjectSummary.mockResolvedValue({ summary: "A summary", model: "claude-x" });
      pool.query.mockResolvedValue({
        rows: [{ ai_summary: "A summary", ai_summary_generated_at: generatedAt, ai_summary_model: "claude-x" }],
      });

      await handler({ data: jobData });

      expect(claude.generateProjectSummary).toHaveBeenCalledWith({
        name: "Solar Forest",
        category: "Reforestation",
        description: "Planting trees",
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("UPDATE projects");
      expect(sql).toContain("ai_summary");
      expect(params[0]).toBe("A summary");
      expect(params[1]).toBe("claude-x");
      expect(params[2]).toMatch(/^[a-f0-9]{64}$/);
      expect(params[3]).toBe("project-1");

      expect(io.to).toHaveBeenCalledWith("project:project-1");
      expect(emit).toHaveBeenCalledWith("ai_summary_ready", {
        projectId: "project-1",
        aiSummary: "A summary",
        aiSummaryGeneratedAt: "2026-01-01T00:00:00.000Z",
        aiSummaryModel: "claude-x",
      });

      expect(audit.logAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: "GADMIN",
          action: "project.summary.generated",
          targetType: "project",
          targetId: "project-1",
          metadata: { model: "claude-x" },
        })
      );
    });

    test("falls back to io.emit when io has no .to and audits as system without admin", async () => {
      const io = { emit: jest.fn() };
      await startAndGetHandler(io);
      claude.generateProjectSummary.mockResolvedValue({ summary: "S", model: "m" });
      pool.query.mockResolvedValue({
        rows: [{ ai_summary: "S", ai_summary_generated_at: new Date(), ai_summary_model: "m" }],
      });

      await handler({ data: { ...jobData, adminAddress: undefined } });

      expect(io.emit).toHaveBeenCalledWith("ai_summary_ready", expect.objectContaining({ projectId: "project-1" }));
      expect(audit.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ actor: "system" }));
    });

    test("does not emit or audit when the project was deleted while queued", async () => {
      const io = { to: jest.fn() };
      await startAndGetHandler(io);
      claude.generateProjectSummary.mockResolvedValue({ summary: "S", model: "m" });
      pool.query.mockResolvedValue({ rows: [] });

      await expect(handler({ data: jobData })).resolves.toBeUndefined();

      expect(io.to).not.toHaveBeenCalled();
      expect(audit.logAdminAction).not.toHaveBeenCalled();
    });

    test("MISSING_API_KEY is permanent: resolves without DB write so pg-boss does not retry", async () => {
      await startAndGetHandler({ to: jest.fn() });
      const err = Object.assign(new Error("no key"), { code: "MISSING_API_KEY" });
      claude.generateProjectSummary.mockRejectedValue(err);

      await expect(handler({ data: jobData })).resolves.toBeUndefined();

      expect(pool.query).not.toHaveBeenCalled();
      expect(audit.logAdminAction).not.toHaveBeenCalled();
    });

    test("failure path: transient Claude error is rethrown so pg-boss retries (retryLimit 3)", async () => {
      const io = { to: jest.fn() };
      await startAndGetHandler(io);
      claude.generateProjectSummary.mockRejectedValue(new Error("rate limited"));

      await expect(handler({ data: jobData })).rejects.toThrow("rate limited");

      expect(pool.query).not.toHaveBeenCalled();
      expect(io.to).not.toHaveBeenCalled();
      expect(audit.logAdminAction).not.toHaveBeenCalled();
    });

    test("failure path: DB write error is rethrown so the job fails and is retried", async () => {
      const io = { to: jest.fn() };
      await startAndGetHandler(io);
      claude.generateProjectSummary.mockResolvedValue({ summary: "S", model: "m" });
      pool.query.mockRejectedValue(new Error("connection lost"));

      await expect(handler({ data: jobData })).rejects.toThrow("connection lost");

      expect(io.to).not.toHaveBeenCalled();
      expect(audit.logAdminAction).not.toHaveBeenCalled();
    });
  });
});