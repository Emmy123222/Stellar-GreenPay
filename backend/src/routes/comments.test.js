"use strict";
/**
 * tests for src/routes/comments.js (#1662)
 *
 *   - everyone can read the thread; empty threads return []
 *   - only wallet-authenticated donors can post
 *   - moderation runs before the INSERT (rejected → 422, nothing stored;
 *     pending_review → stored hidden; approved → visible)
 *   - creation is rate limited per wallet
 *   - soft delete by author or admin only
 *
 * The real rate limiter runs against its in-memory store (redis is mocked as
 * not connected). Moderation is mocked in the wiring tests; the rule logic
 * itself is covered by src/services/moderation.text.test.js.
 */

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/redis", () => ({
  client: { status: "end" },
  sendCommand: jest.fn().mockResolvedValue("sha"),
}));
jest.mock("../services/moderation", () => {
  const actual = jest.requireActual("../services/moderation");
  return {
    STATUS: actual.STATUS,
    moderationSummary: actual.moderationSummary,
    moderateText: jest.fn(actual.moderateText),
  };
});

process.env.ADMIN_API_KEY = "test-admin-key";
process.env.COMMENTS_RATE_LIMIT = "3";

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const moderation = require("../services/moderation");
const { signToken, signAdminToken } = require("../middleware/auth");
const { clearMemoryStore } = require("../middleware/rateLimiter");
const commentsRouter = require("./comments");

const DONOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";

function walletToken(address) {
  return signToken({ sub: address, type: "wallet" }, "1h");
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/comments", commentsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

function commentRow(overrides = {}) {
  return {
    id: COMMENT_ID,
    project_id: PROJECT_ID,
    author_address: DONOR,
    author_display_name: null,
    body: "Great work on the mangroves!",
    moderation_status: "approved",
    moderation_labels: [],
    created_at: "2026-10-01T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

/** Queue the three reads POST makes before the INSERT. */
function mockDonorChecks({ project = true, donated = true } = {}) {
  pool.query
    .mockResolvedValueOnce({ rows: project ? [{ id: PROJECT_ID }] : [] })
    .mockResolvedValueOnce({ rows: donated ? [{ "?column?": 1 }] : [] });
}

function insertCalls() {
  return pool.query.mock.calls.filter(([sql]) => /INSERT INTO project_comments/.test(sql));
}

let app;

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockReset();
  clearMemoryStore();
  app = buildApp();
});

describe("GET /api/comments/project/:projectId", () => {
  it("is public and returns an empty list for a thread with no comments", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/api/comments/project/${PROJECT_ID}`).expect(200);

    expect(res.body).toEqual({ success: true, data: [], next_cursor: null, has_more: false });
  });

  it("only selects approved, non-deleted comments", async () => {
    pool.query.mockResolvedValueOnce({ rows: [commentRow()] });

    const res = await request(app).get(`/api/comments/project/${PROJECT_ID}`).expect(200);

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/moderation_status = 'approved'/);
    expect(values[0]).toBe(PROJECT_ID);
    expect(res.body.data[0]).toMatchObject({
      id: COMMENT_ID,
      authorAddress: DONOR,
      body: "Great work on the mangroves!",
    });
  });

  it("returns a next_cursor when there are more pages and accepts it back", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [commentRow(), commentRow({ id: "33333333-3333-4333-8333-333333333333" })],
    });
    const first = await request(app)
      .get(`/api/comments/project/${PROJECT_ID}?limit=1`)
      .expect(200);
    expect(first.body.has_more).toBe(true);
    expect(first.body.data).toHaveLength(1);

    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app)
      .get(`/api/comments/project/${PROJECT_ID}?limit=1&cursor=${encodeURIComponent(first.body.next_cursor)}`)
      .expect(200);
    expect(pool.query.mock.calls[1][1]).toEqual([PROJECT_ID, "2026-10-01T12:00:00.000Z", COMMENT_ID, 2]);
  });

  it("rejects a malformed cursor", async () => {
    await request(app).get(`/api/comments/project/${PROJECT_ID}?cursor=not-base64-json`).expect(400);
  });
});

describe("POST /api/comments — authentication and donor check", () => {
  it("rejects anonymous requests", async () => {
    await request(app).post("/api/comments").send({ projectId: PROJECT_ID, body: "hi" }).expect(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects an admin token (comments are donor-only)", async () => {
    await request(app)
      .post("/api/comments")
      .set("Authorization", `Bearer ${signAdminToken({ role: "admin", type: "admin", sub: "a" })}`)
      .send({ projectId: PROJECT_ID, body: "hi" })
      .expect(401);
  });

  it("returns 403 when the wallet has not donated to the project", async () => {
    mockDonorChecks({ donated: false });

    const res = await request(app)
      .post("/api/comments")
      .set("Authorization", `Bearer ${walletToken(DONOR)}`)
      .send({ projectId: PROJECT_ID, body: "Hello" })
      .expect(403);

    expect(res.body.error).toMatch(/Only donors/);
    expect(insertCalls()).toHaveLength(0);
  });

  it("returns 404 for an unknown project", async () => {
    mockDonorChecks({ project: false });
    await request(app)
      .post("/api/comments")
      .set("Authorization", `Bearer ${walletToken(DONOR)}`)
      .send({ projectId: PROJECT_ID, body: "Hello" })
      .expect(404);
  });

  it("validates the body", async () => {
    const auth = `Bearer ${walletToken(DONOR)}`;
    await request(app).post("/api/comments").set("Authorization", auth).send({ projectId: PROJECT_ID }).expect(400);
    await request(app).post("/api/comments").set("Authorization", auth).send({ projectId: PROJECT_ID, body: "   " }).expect(400);
    await request(app)
      .post("/api/comments")
      .set("Authorization", auth)
      .send({ projectId: PROJECT_ID, body: "x".repeat(1001) })
      .expect(400);
  });

  it("stores the comment against the token's wallet, not the body", async () => {
    mockDonorChecks();
    pool.query.mockResolvedValueOnce({ rows: [commentRow()] });

    const res = await request(app)
      .post("/api/comments")
      .set("Authorization", `Bearer ${walletToken(DONOR)}`)
      .send({ projectId: PROJECT_ID, body: "  Great work on the mangroves!  ", authorAddress: OTHER })
      .expect(201);

    const [, values] = insertCalls()[0];
    expect(values[2]).toBe(DONOR);
    expect(values[3]).toBe("Great work on the mangroves!");
    expect(values[4]).toBe("approved");
    expect(res.body.data.moderation).toBeUndefined();
  });
});

describe("POST /api/comments — moderation pipeline", () => {
  const auth = () => `Bearer ${walletToken(DONOR)}`;

  it("rejects blocked text with 422 and stores nothing", async () => {
    mockDonorChecks();

    const res = await request(app)
      .post("/api/comments")
      .set("Authorization", auth())
      .send({ projectId: PROJECT_ID, body: "DM me your seed phrase to claim a bonus" })
      .expect(422);

    expect(res.body.code).toBe("comment_rejected");
    expect(moderation.moderateText).toHaveBeenCalledWith({ text: "DM me your seed phrase to claim a bonus" });
    expect(insertCalls()).toHaveLength(0);
  });

  it("rejects a pasted Stellar secret key", async () => {
    mockDonorChecks();
    const secret = `S${"A".repeat(55)}`;

    const res = await request(app)
      .post("/api/comments")
      .set("Authorization", auth())
      .send({ projectId: PROJECT_ID, body: `my key is ${secret}` })
      .expect(422);

    expect(res.body.error).toMatch(/secret key/i);
    expect(insertCalls()).toHaveLength(0);
  });

  it("stores flagged text as pending_review and reports it", async () => {
    mockDonorChecks();
    pool.query.mockResolvedValueOnce({ rows: [commentRow({ moderation_status: "pending_review" })] });

    const res = await request(app)
      .post("/api/comments")
      .set("Authorization", auth())
      .send({ projectId: PROJECT_ID, body: "More info at https://example.com/project" })
      .expect(201);

    const [, values] = insertCalls()[0];
    expect(values[4]).toBe("pending_review");
    expect(JSON.parse(values[5])).toEqual(["links"]);
    expect(res.body.data.moderationStatus).toBe("pending_review");
    expect(res.body.data.moderation).toMatchObject({ status: "pending_review", flaggedForReview: true });
  });

  it("runs moderation before the INSERT", async () => {
    mockDonorChecks();
    pool.query.mockResolvedValueOnce({ rows: [commentRow()] });

    await request(app)
      .post("/api/comments")
      .set("Authorization", auth())
      .send({ projectId: PROJECT_ID, body: "Lovely project" })
      .expect(201);

    const moderatedAt = moderation.moderateText.mock.invocationCallOrder[0];
    const insertIndex = pool.query.mock.calls.findIndex(([sql]) => /INSERT INTO project_comments/.test(sql));
    expect(moderatedAt).toBeLessThan(pool.query.mock.invocationCallOrder[insertIndex]);
  });
});

describe("POST /api/comments — rate limiting", () => {
  function post(address) {
    return request(app)
      .post("/api/comments")
      .set("Authorization", `Bearer ${walletToken(address)}`)
      .send({ projectId: PROJECT_ID, body: "Thanks for the update" });
  }

  it("returns 429 after COMMENTS_RATE_LIMIT posts from one wallet", async () => {
    for (let i = 0; i < 3; i++) {
      mockDonorChecks();
      pool.query.mockResolvedValueOnce({ rows: [commentRow()] });
      const res = await post(DONOR);
      expect(res.status).toBe(201);
      expect(res.headers["x-ratelimit-limit"]).toBe("3");
    }

    const blocked = await post(DONOR);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(insertCalls()).toHaveLength(3);
  });

  it("buckets by wallet, so another donor is not blocked", async () => {
    for (let i = 0; i < 3; i++) {
      mockDonorChecks();
      pool.query.mockResolvedValueOnce({ rows: [commentRow()] });
      await post(DONOR);
    }
    expect((await post(DONOR)).status).toBe(429);

    mockDonorChecks();
    pool.query.mockResolvedValueOnce({ rows: [commentRow({ author_address: OTHER })] });
    expect((await post(OTHER)).status).toBe(201);
  });

  it("does not rate limit reads", async () => {
    for (let i = 0; i < 6; i++) {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await request(app).get(`/api/comments/project/${PROJECT_ID}`).expect(200);
    }
  });
});

describe("DELETE /api/comments/:id", () => {
  it("lets the author soft-delete their comment", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [commentRow()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await request(app)
      .delete(`/api/comments/${COMMENT_ID}`)
      .set("Authorization", `Bearer ${walletToken(DONOR)}`)
      .expect(200);

    const [sql, values] = pool.query.mock.calls[1];
    expect(sql).toMatch(/SET deleted_at = NOW\(\), deleted_by = \$2/);
    expect(sql).not.toMatch(/DELETE FROM/);
    expect(values).toEqual([COMMENT_ID, DONOR]);
  });

  it("forbids other wallets", async () => {
    pool.query.mockResolvedValueOnce({ rows: [commentRow()] });
    await request(app)
      .delete(`/api/comments/${COMMENT_ID}`)
      .set("Authorization", `Bearer ${walletToken(OTHER)}`)
      .expect(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("lets an admin delete any comment (X-Admin-Key)", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [commentRow()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await request(app)
      .delete(`/api/comments/${COMMENT_ID}`)
      .set("X-Admin-Key", "test-admin-key")
      .expect(200);
    expect(pool.query.mock.calls[1][1]).toEqual([COMMENT_ID, "admin:admin-key"]);
  });

  it("lets an admin delete any comment (admin JWT)", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [commentRow()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await request(app)
      .delete(`/api/comments/${COMMENT_ID}`)
      .set("Authorization", `Bearer ${signAdminToken({ role: "admin", type: "admin", sub: "ops" })}`)
      .expect(200);
    expect(pool.query.mock.calls[1][1]).toEqual([COMMENT_ID, "admin:ops"]);
  });

  it("returns 404 for a missing or already-deleted comment", async () => {
    pool.query.mockResolvedValueOnce({ rows: [commentRow({ deleted_at: new Date() })] });
    await request(app)
      .delete(`/api/comments/${COMMENT_ID}`)
      .set("Authorization", `Bearer ${walletToken(DONOR)}`)
      .expect(404);
  });

  it("requires authentication", async () => {
    await request(app).delete(`/api/comments/${COMMENT_ID}`).expect(401);
  });
});

describe("admin moderation queue", () => {
  it("lists pending comments for admins only", async () => {
    await request(app).get("/api/comments/pending").expect(401);

    pool.query.mockResolvedValueOnce({
      rows: [commentRow({ moderation_status: "pending_review", moderation_labels: ["links"] })],
    });
    const res = await request(app)
      .get("/api/comments/pending")
      .set("X-Admin-Key", "test-admin-key")
      .expect(200);
    expect(res.body.data[0]).toMatchObject({ moderationStatus: "pending_review", moderationLabels: ["links"] });
  });

  it("approves a pending comment", async () => {
    pool.query.mockResolvedValueOnce({ rows: [commentRow()] });
    const res = await request(app)
      .post(`/api/comments/${COMMENT_ID}/approve`)
      .set("X-Admin-Key", "test-admin-key")
      .expect(200);
    expect(res.body.data.moderationStatus).toBe("approved");
  });

  it("does not let a donor approve", async () => {
    await request(app)
      .post(`/api/comments/${COMMENT_ID}/approve`)
      .set("Authorization", `Bearer ${walletToken(DONOR)}`)
      .expect(401);
  });
});
