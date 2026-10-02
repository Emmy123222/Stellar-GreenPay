"use strict";
/**
 * tests for issue #1101 wiring in src/routes/updates.js
 *
 * POST /api/updates must moderate `image_url` BEFORE persisting anything:
 *   - rejected image            → 422, no project_updates INSERT, decision logged
 *   - scanner unavailable       → 503, no project_updates INSERT
 *   - pending_review            → 201, decision logged against the new update
 *   - an earlier upload-time decision → 201 and back-filled with update_id
 *   - skipped (not configured)  → 201, no moderation writes at all
 * The moderation service itself is mocked; its logic is covered by
 * src/services/moderation.test.js.
 */

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/email", () => ({
  sendUpdateNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/push", () => ({
  sendUpdatePushNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/moderation", () => ({
  STATUS: { APPROVED: "approved", REJECTED: "rejected", PENDING_REVIEW: "pending_review" },
  OUTCOME: {
    APPROVED: "approved",
    REJECTED: "rejected",
    PENDING_REVIEW: "pending_review",
    SKIPPED: "skipped",
    UNAVAILABLE: "unavailable",
  },
  moderateImage: jest.fn(),
  recordModerationDecision: jest.fn().mockResolvedValue("dec-1"),
  attachDecisionToUpdateImage: jest.fn().mockResolvedValue(true),
  moderationSummary: jest.fn((verdict) =>
    verdict && verdict.applied
      ? {
        status: verdict.status,
        flaggedForReview: !!verdict.flaggedForReview,
        maxConfidence: verdict.maxConfidence,
        provider: verdict.provider,
        reason: verdict.reason,
      }
      : undefined,
  ),
}));

const pool = require("../db/pool");
const moderation = require("../services/moderation");
const express = require("express");
const request = require("supertest");
const updatesRouter = require("./updates");

process.env.ADMIN_API_KEY = "test-admin-key";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/updates", updatesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const MOCK_PROJECT_ROW = {
  id: "proj-1",
  name: "Test Project",
  description: "desc",
  category: "Reforestation",
  location: "Brazil",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  goal_xlm: "10000",
  raised_xlm: "5000",
  donor_count: 42,
  co2_offset_kg: 50000,
  status: "active",
  verified: true,
  on_chain_verified: false,
  tags: ["reforestation"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const MOCK_UPDATE_ROW = {
  id: "upd-1",
  project_id: "proj-1",
  title: "We planted 500 trees",
  body: "Great progress this month.",
  image_url: "https://greenpay-uploads.s3.us-east-1.amazonaws.com/photo.jpg",
  created_at: new Date().toISOString(),
};

const IMAGE_URL = MOCK_UPDATE_ROW.image_url;

function verdict(overrides) {
  return {
    applied: true,
    blocked: false,
    status: moderation.STATUS.APPROVED,
    reason: null,
    maxConfidence: 1,
    labels: [],
    flaggedForReview: false,
    newDecision: true,
    decisionId: null,
    provider: "aws_rekognition",
    imageUrl: IMAGE_URL,
    storageKey: "photo.jpg",
    bucket: "greenpay-uploads",
    ...overrides,
  };
}

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = buildApp();
  pool.query
    .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] }) // SELECT projects
    .mockResolvedValueOnce({ rows: [MOCK_UPDATE_ROW] }) // INSERT project_updates
    .mockResolvedValue({ rows: [] }); // anything after
  moderation.moderateImage.mockResolvedValue(verdict({}));
  moderation.recordModerationDecision.mockResolvedValue("dec-1");
  moderation.attachDecisionToUpdateImage.mockResolvedValue(true);
});

function adminPost(body) {
  return request(app)
    .post("/api/updates")
    .set("X-Admin-Key", "test-admin-key")
    .send(body);
}

function insertUpdateCalls() {
  return pool.query.mock.calls.filter(([sql]) => /INSERT INTO project_updates/.test(sql));
}

describe("POST /api/updates — image moderation (issue #1101)", () => {
  test("scans image_url before the update is persisted", async () => {
    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: IMAGE_URL,
    });
    expect(res.status).toBe(201);
    expect(moderation.moderateImage).toHaveBeenCalledTimes(1);
    expect(moderation.moderateImage).toHaveBeenCalledWith({
      imageUrl: IMAGE_URL,
      storageBackend: "s3",
    });
  });

  test("does not run moderation when no image is attached", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] })
      .mockResolvedValueOnce({ rows: [{ ...MOCK_UPDATE_ROW, image_url: null }] })
      .mockResolvedValue({ rows: [] });

    const res = await adminPost({ projectId: "proj-1", title: "T", body: "B" });
    expect(res.status).toBe(201);
    expect(moderation.moderateImage).not.toHaveBeenCalled();
    expect(moderation.recordModerationDecision).not.toHaveBeenCalled();
  });

  test("rejects an NSFW image with 422 and never persists the update", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({
        status: moderation.STATUS.REJECTED,
        blocked: true,
        maxConfidence: 93,
        reason: "Image auto-rejected: \"Graphic Nudity\" at 93% confidence exceeds the 70% limit.",
        labels: [{ name: "Graphic Nudity", family: "Explicit Nudity", confidence: 93, categories: [] }],
      }),
    );

    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: IMAGE_URL,
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("image_rejected");
    expect(res.body.error).toMatch(/auto-rejected/i);
    expect(insertUpdateCalls()).toHaveLength(0);
    // Logged for the audit trail / admin visibility, with no update_id.
    expect(moderation.recordModerationDecision).toHaveBeenCalledTimes(1);
    const logged = moderation.recordModerationDecision.mock.calls[0][0];
    expect(logged.status).toBe("rejected");
    expect(logged.projectId).toBe("proj-1");
    expect(logged.updateId).toBeUndefined();
    expect(logged.storageKey).toBe("photo.jpg");
  });

  test("an unreachable scanner fails closed with 503 and persists nothing", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({ status: moderation.OUTCOME.UNAVAILABLE, blocked: true, newDecision: false, reason: "Image could not be scanned (timeout)." }),
    );

    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: IMAGE_URL,
    });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("image_moderation_unavailable");
    expect(insertUpdateCalls()).toHaveLength(0);
    expect(moderation.recordModerationDecision).not.toHaveBeenCalled();
  });

  test("publishes a flagged image (201) and records it against the new update", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({
        status: moderation.STATUS.PENDING_REVIEW,
        flaggedForReview: true,
        maxConfidence: 61,
        reason: "Flagged for manual review",
      }),
    );

    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: IMAGE_URL,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.moderation).toMatchObject({
      status: "pending_review",
      flaggedForReview: true,
    });
    expect(insertUpdateCalls()).toHaveLength(1);
    const logged = moderation.recordModerationDecision.mock.calls[0][0];
    expect(logged.status).toBe("pending_review");
    expect(logged.updateId).toBe(insertUpdateCalls()[0][1][0]); // the id that was inserted
    expect(logged.projectId).toBe("proj-1");
  });

  test("an approved image is logged too (full audit trail)", async () => {
    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: IMAGE_URL,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.moderation).toBeUndefined();
    const logged = moderation.recordModerationDecision.mock.calls[0][0];
    expect(logged.status).toBe("approved");
    expect(logged.updateId).toBe(insertUpdateCalls()[0][1][0]);
  });

  test("reuses an upload-time decision instead of writing a duplicate row", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({ newDecision: false, decisionId: "dec-9", reusedPriorDecision: true }),
    );

    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: IMAGE_URL,
    });

    expect(res.status).toBe(201);
    expect(moderation.recordModerationDecision).not.toHaveBeenCalled();
    expect(moderation.attachDecisionToUpdateImage).toHaveBeenCalledWith({
      decisionId: "dec-9",
      updateId: insertUpdateCalls()[0][1][0],
      projectId: "proj-1",
    });
  });

  test("skipped moderation (not configured) leaves the old behaviour intact", async () => {
    moderation.moderateImage.mockResolvedValue({
      applied: false,
      blocked: false,
      status: moderation.OUTCOME.SKIPPED,
      skipReason: "not_configured",
      reason: null,
      maxConfidence: null,
      labels: [],
      flaggedForReview: false,
      newDecision: false,
      decisionId: null,
    });

    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: IMAGE_URL,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toBe(IMAGE_URL);
    expect(res.body.data.moderation).toBeUndefined();
    expect(moderation.recordModerationDecision).not.toHaveBeenCalled();
    expect(moderation.attachDecisionToUpdateImage).not.toHaveBeenCalled();
  });

  test("validation still short-circuits before any scan", async () => {
    const res = await adminPost({ projectId: "proj-1", title: "T", body: "B", image_url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(moderation.moderateImage).not.toHaveBeenCalled();
  });

  test("a rejected update is not notified to subscribers", async () => {
    moderation.moderateImage.mockResolvedValue(
      verdict({ status: moderation.STATUS.REJECTED, blocked: true, reason: "nope" }),
    );
    const { sendUpdateNotifications } = require("../services/email");

    await adminPost({ projectId: "proj-1", title: "T", body: "B", image_url: IMAGE_URL });

    expect(sendUpdateNotifications).not.toHaveBeenCalled();
  });
});
