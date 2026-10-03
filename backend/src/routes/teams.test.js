"use strict";
/**
 * src/routes/teams.test.js
 *
 * Tests team creation, invite-code joining, the caller's team lookup, and
 * the team leaderboard.
 */

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const teamsRouter = require("./teams");
const leaderboardRouter = require("./leaderboard");
const { signToken } = require("../middleware/auth");

const TEAM_ID = "t1ac10b-58cc-4372-a567-0e02b2c3d479";
const CREATOR = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const MEMBER = "GBVNQON4MFVGJXK5WT7VQJJZXFVHZJB6BHFWJCW7OF5BLNGOLZJQHIY";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/teams", teamsRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

function authHeader(address) {
  return { Authorization: `Bearer ${signToken({ sub: address, type: "wallet" }, "1h")}` };
}

const TEAM_ROW = {
  id: TEAM_ID,
  name: "Acme Giving",
  logo_url: "https://example.com/logo.png",
  invite_code: "acme2026",
  created_by: CREATOR,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
  member_count: 2,
  total_donated_xlm: "150.0000000",
  total_co2_offset_kg: "1800.0000000",
};

/** Mock the transactional create flow: INSERT team, INSERT member, then stats. */
function mockCreateSuccess() {
  pool.connect.mockResolvedValue({
    query: jest.fn().mockImplementation((sql) => {
      if (sql.includes("BEGIN") || sql.includes("COMMIT") || sql.includes("ROLLBACK")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("INSERT INTO teams")) {
        return Promise.resolve({ rows: [TEAM_ROW] });
      }
      if (sql.includes("INSERT INTO team_members")) {
        return Promise.resolve({ rows: [{ id: "m1" }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  });
  // Pre-checks (membership, invite code) return no rows; the final
  // fetchTeamWithStats query returns the team row.
  pool.query.mockImplementation((sql) => {
    if (sql.includes("FROM team_members WHERE wallet_address")
      || sql.includes("FROM teams WHERE invite_code")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [TEAM_ROW] });
  });
}

describe("POST /api/teams", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/teams")
      .send({ name: "Acme Giving" });

    expect(res.status).toBe(401);
  });

  it("creates a team and makes the creator its first member", async () => {
    mockCreateSuccess();

    const res = await request(app)
      .post("/api/teams")
      .set(authHeader(CREATOR))
      .send({ name: "Acme Giving", logoUrl: "https://example.com/logo.png" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Acme Giving");
    expect(res.body.data.memberCount).toBe(2);
    expect(res.body.data.inviteCode).toBeDefined();
    expect(res.body.data.totalDonatedXLM).toBe("150.0000000");
  });

  it("rejects a missing name", async () => {
    const res = await request(app)
      .post("/api/teams")
      .set(authHeader(CREATOR))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it("rejects an invalid logoUrl", async () => {
    mockCreateSuccess();

    const res = await request(app)
      .post("/api/teams")
      .set(authHeader(CREATOR))
      .send({ name: "Acme Giving", logoUrl: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/logoUrl/);
  });

  it("rejects a wallet that is already on a team", async () => {
    pool.query.mockResolvedValue({ rows: [{ 1: 1 }] }); // existing membership

    const res = await request(app)
      .post("/api/teams")
      .set(authHeader(CREATOR))
      .send({ name: "Second Team" });

    expect(res.status).toBe(409);
  });

  it("rejects a duplicate invite code", async () => {
    pool.query
    .mockResolvedValueOnce({ rows: [] }) // no existing membership
    .mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // invite code taken

    const res = await request(app)
      .post("/api/teams")
      .set(authHeader(CREATOR))
      .send({ name: "Acme Giving", inviteCode: "taken123" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/inviteCode/);
  });
});

describe("POST /api/teams/:id/join", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("rejects an invalid invite code", async () => {
    pool.query.mockResolvedValue({ rows: [TEAM_ROW] }); // team lookup

    const res = await request(app)
      .post(`/api/teams/${TEAM_ID}/join`)
      .set(authHeader(MEMBER))
      .send({ inviteCode: "wrong-code" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invite code/i);
  });

  it("rejects a nonexistent team", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post(`/api/teams/${TEAM_ID}/join`)
      .set(authHeader(MEMBER))
      .send({ inviteCode: "acme2026" });

    expect(res.status).toBe(404);
  });

  it("joins a team with the correct invite code", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("FROM teams")) {
        return Promise.resolve({ rows: [TEAM_ROW] });
      }
      if (sql.includes("INSERT INTO team_members")) {
        return Promise.resolve({ rows: [{ id: "m2" }] });
      }
      return Promise.resolve({ rows: [TEAM_ROW] });
    });

    const res = await request(app)
      .post(`/api/teams/${TEAM_ID}/join`)
      .set(authHeader(MEMBER))
      .send({ inviteCode: "acme2026" });

    expect(res.status).toBe(201);
    expect(res.body.data.isMember).toBe(true);
  });

  it("is idempotent for an existing member", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("FROM teams")) {
        return Promise.resolve({ rows: [TEAM_ROW] });
      }
      if (sql.includes("INSERT INTO team_members")) {
        return Promise.resolve({ rows: [] });      }
      return Promise.resolve({ rows: [TEAM_ROW] });
    });

    const res = await request(app)
      .post(`/api/teams/${TEAM_ID}/join`)
      .set(authHeader(CREATOR))
      .send({ inviteCode: "acme2026" });

    expect(res.status).toBe(200);
    expect(res.body.data.isMember).toBe(true);
  });

  it("rejects a wallet already on another team", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("FROM teams")) {
        return Promise.resolve({ rows: [TEAM_ROW] });
      }
      if (sql.includes("INSERT INTO team_members")) {
        const err = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post(`/api/teams/${TEAM_ID}/join`)
      .set(authHeader(MEMBER))
      .send({ inviteCode: "acme2026" });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/teams/my", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("returns null when the wallet is on no team", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get("/api/teams/my")
      .set(authHeader(MEMBER));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("returns the caller's team with combined stats", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ team_id: TEAM_ID }] })
      .mockResolvedValueOnce({ rows: [TEAM_ROW] });

    const res = await request(app)
      .get("/api/teams/my")
      .set(authHeader(CREATOR));

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(TEAM_ID);
    expect(res.body.data.totalDonatedXLM).toBe("150.0000000");
    expect(res.body.data.isMember).toBe(true);
  });
});

describe("GET /api/leaderboard/teams", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("returns teams ranked by combined total_donated", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: TEAM_ID,
          name: "Acme Giving",
          logo_url: null,
          member_count: 2,
          total_donated_xlm: "150.0000000",
          total_co2_offset_kg: "1800.0000000",
        },
      ],
    });

    const res = await request(app).get("/api/leaderboard/teams");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Acme Giving");
    expect(res.body.data[0].totalDonatedXLM).toBe("150.0000000");
    expect(res.body.data[0].memberCount).toBe(2);
    expect(res.body.data[0].rank).toBe(1);
  });

  it("reports has_more when more teams exist", async () => {
    const row = (id, name, total) => ({
      id,
      name,
      logo_url: null,
      member_count: 1,
      total_donated_xlm: total,
      total_co2_offset_kg: "0",
    });
    pool.query.mockResolvedValue({
      rows: [row("t1", "A", "10"), row("t2", "B", "9")], // limit+1 with default limit 50? no — limit is 50
    });

    const res = await request(app).get("/api/leaderboard/teams?limit=1");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.has_more).toBe(true);
    expect(res.body.next_offset).toBe(1);
  });
});
