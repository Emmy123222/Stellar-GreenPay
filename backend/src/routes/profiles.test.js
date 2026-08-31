"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const profilesRouter = require("./profiles");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/profiles", profilesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("POST /api/profiles", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("rejects HTML in profile display name with 422 field errors", async () => {
    const res = await request(app)
      .post("/api/profiles")
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
    const res = await request(app)
      .post("/api/profiles")
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
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
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

    const res = await request(app)
      .patch(`/api/profiles/${PUBLIC_KEY}`)
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

    const res = await request(app)
      .patch(`/api/profiles/${PUBLIC_KEY}`)
      .send({ avatarUrl: null })
      .expect(200);

    expect(res.body.data.avatarUrl).toBeNull();
  });

  test("returns 404 when profile does not exist", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch(`/api/profiles/${PUBLIC_KEY}`)
      .send({ avatarUrl: "https://cdn.example.com/a.png" })
      .expect(404);

    expect(res.body.error).toBe("Profile not found");
  });

  test("rejects empty patch body with 422", async () => {
    const res = await request(app)
      .patch(`/api/profiles/${PUBLIC_KEY}`)
      .send({})
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
  });
});
