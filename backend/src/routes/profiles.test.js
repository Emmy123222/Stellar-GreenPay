"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/sentry", () => ({
  initSentry: jest.fn(),
  errorHandler: () => (err, _req, _res, next) => next(err),
}));
jest.mock("../services/profileQueue", () => ({
  start: jest.fn(),
  enqueueAvatarProcessing: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/summaryQueue", () => ({ start: jest.fn() }));
jest.mock("../services/statsRefreshQueue", () => ({ start: jest.fn() }));
jest.mock("../services/indexerService", () => ({ startIndexer: jest.fn() }));
jest.mock("../services/socketHandler", () => ({ registerSocketHandlers: jest.fn() }));
jest.mock("../db/migrate", () => ({ runMigrations: jest.fn() }));
jest.mock("../services/turrets", () => ({ startTurretsServer: jest.fn() }));
jest.mock("../services/stellar", () => ({
  isStellarTimeoutError: jest.fn(() => false),
  server: {},
}));
jest.mock("../services/metrics", () => ({
  metricsHandler: (_req, res) => res.end(),
  countRequest: jest.fn(),
  startQueueRefresh: jest.fn(),
}));

const mockPassThroughRouter = (_req, _res, next) => next();
jest.mock("../routes/projects", () => mockPassThroughRouter);
jest.mock("../routes/uploads", () => mockPassThroughRouter);
jest.mock("../routes/donations", () => mockPassThroughRouter);
jest.mock("../routes/stats", () => mockPassThroughRouter);
jest.mock("../routes/health", () => mockPassThroughRouter);
jest.mock("../routes/readiness", () => mockPassThroughRouter);
jest.mock("../routes/impact", () => mockPassThroughRouter);
jest.mock("../routes/subscriptions", () => mockPassThroughRouter);
jest.mock("../routes/referrals", () => mockPassThroughRouter);
jest.mock("../routes/recurringDonations", () => mockPassThroughRouter);
jest.mock("../routes/auth", () => mockPassThroughRouter);
jest.mock("../routes/ratings", () => mockPassThroughRouter);
jest.mock("../routes/teams", () => mockPassThroughRouter);

const pool = require("../db/pool");
const request = require("supertest");
const app = require("../server");

const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("POST /api/profiles", () => {
  let client;
  let csrfToken;

  beforeEach(async () => {
    client = request.agent(app);
    jest.clearAllMocks();
    csrfToken = (await client.get("/api/csrf-token").expect(200)).body.csrfToken;
  });

  test("rejects HTML in profile display name with 422 field errors", async () => {
    const res = await client
      .post("/api/profiles")
      .set("X-CSRF-Token", csrfToken)
      .send({
        publicKey: PUBLIC_KEY,
        displayName: "<b>Bad</b>",
        bio: "A short bio",
      })
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.displayName).toBeDefined();
  });

  test("rejects invalid avatarUrl with 422", async () => {
    const res = await client
      .post("/api/profiles")
      .set("X-CSRF-Token", csrfToken)
      .send({
        publicKey: PUBLIC_KEY,
        avatarUrl: "not-a-url",
      })
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.avatarUrl).toBeDefined();
  });
});

describe("PATCH /api/profiles/:publicKey", () => {
  let client;
  let csrfToken;

  beforeEach(async () => {
    client = request.agent(app);
    jest.clearAllMocks();
    csrfToken = (await client.get("/api/csrf-token").expect(200)).body.csrfToken;
  });

  test("updates avatarUrl for an existing profile", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        public_key: PUBLIC_KEY,
        display_name: "Ada",
        bio: "Donor",
        avatar_url: "https://cdn.example.com/avatar.png",
        total_donated_xlm: "10.0000000",
        projects_supported: 1,
        badges: [],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      }],
    });

    const res = await client
      .patch(`/api/profiles/${PUBLIC_KEY}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ avatarUrl: "https://cdn.example.com/avatar.png" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.avatarUrl).toBe("https://cdn.example.com/avatar.png");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE profiles SET"),
      expect.arrayContaining(["https://cdn.example.com/avatar.png", PUBLIC_KEY]),
    );
  });

  test("clears avatarUrl when null is sent", async () => {
    pool.query.mockResolvedValue({
      rows: [{
        public_key: PUBLIC_KEY,
        display_name: "Ada",
        bio: "Donor",
        avatar_url: null,
        total_donated_xlm: "0",
        projects_supported: 0,
        badges: [],
        created_at: null,
        updated_at: null,
      }],
    });

    const res = await client
      .patch(`/api/profiles/${PUBLIC_KEY}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ avatarUrl: null })
      .expect(200);

    expect(res.body.data.avatarUrl).toBeNull();
  });

  test("returns 404 when profile does not exist", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await client
      .patch(`/api/profiles/${PUBLIC_KEY}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ avatarUrl: "https://cdn.example.com/a.png" })
      .expect(404);

    expect(res.body.error).toBe("Profile not found");
  });

  test("rejects empty patch body with 422", async () => {
    const res = await client
      .patch(`/api/profiles/${PUBLIC_KEY}`)
      .set("X-CSRF-Token", csrfToken)
      .send({})
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
  });
});

describe("GET profile endpoints", () => {
  test.each(["/api/profiles", "/api/v1/profiles"])("serves %s from the exported app", async (prefix) => {
    const client = request(app);
    pool.query
      .mockResolvedValueOnce({ rows: [{ public_key: PUBLIC_KEY, display_name: "Ada", badges: [] }] })
      .mockResolvedValueOnce({ rows: [{ total_co2_offset_kg: "12" }] });

    const res = await client.get(`${prefix}/${PUBLIC_KEY}`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalCo2OffsetKg).toBe(12);
  });
});
