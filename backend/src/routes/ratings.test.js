"use strict";
/**
 * src/routes/ratings.test.js
 *
 * Tests POST /api/ratings: wallet authentication, payload validation,
 * backend donation verification, and the one-rating-per-donor upsert.
 */

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const ratingsRouter = require("./ratings");
const { signToken } = require("../middleware/auth");

const PROJECT_ID = "c4ac10b-58cc-4372-a567-0e02b2c3d479";
const DONOR = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ratings", ratingsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

function authHeader(address = DONOR) {
  return { Authorization: `Bearer ${signToken({ sub: address, type: "wallet" }, "1h")}` };
}

const RATING_ROW = {
  id: "r1",
  project_id: PROJECT_ID,
  donor_address: DONOR,
  rating: 5,
  review: "Great project",
  created_at: new Date("2026-01-01T00:00:00Z"),
};

/** Mock the project-exists check and the donation verification. */
function mockDonorEligible() {
  pool.query.mockImplementation((sql) => {
    if (sql.includes("FROM projects")) {
      return Promise.resolve({ rows: [{ id: PROJECT_ID }] });
    }
    if (sql.includes("FROM donations")) {
      return Promise.resolve({ rows: [{ 1: 1 }] });
    }
    if (sql.includes("INSERT INTO project_ratings")) {
      return Promise.resolve({ rows: [RATING_ROW] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("POST /api/ratings", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/ratings")
      .send({ project_id: PROJECT_ID, stars: 5, review_text: "Great" });

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a non-integer star value", async () => {
    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 4.5, review_text: "Great" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stars/);
  });

  it("rejects a star value above 5", async () => {
    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 6 });

    expect(res.status).toBe(400);
  });

  it("rejects a missing project_id", async () => {
    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ stars: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project_id/);
  });

  it("rejects an over-long review_text", async () => {
    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 5, review_text: "x".repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/review_text/);
  });

  it("returns 404 for a nonexistent project", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("FROM projects")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 5 });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the donor has not donated to the project", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("FROM projects")) {
        return Promise.resolve({ rows: [{ id: PROJECT_ID }] });
      }
      if (sql.includes("FROM donations")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 5 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only donors/i);
  });

  it("creates a rating for an eligible donor", async () => {
    mockDonorEligible();

    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 5, review_text: "Great project" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.donorAddress).toBe(DONOR);

    // The donor address must come from the verified token, not the body.
    const insertCall = pool.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO project_ratings"),
    );
    expect(insertCall[1][2]).toBe(DONOR);
  });

  it("upserts (updates) the donor's existing rating", async () => {
    mockDonorEligible();

    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 4, review_text: "Updated review" });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO project_ratings"),
    );
    expect(insertCall[0]).toContain("ON CONFLICT (project_id, donor_address) DO UPDATE");
  });

  it("stores review_text as null when omitted", async () => {
    mockDonorEligible();

    const res = await request(app)
      .post("/api/ratings")
      .set(authHeader())
      .send({ project_id: PROJECT_ID, stars: 3 });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO project_ratings"),
    );
    expect(insertCall[1][4]).toBeNull();
  });
});
