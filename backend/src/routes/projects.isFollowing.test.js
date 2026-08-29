"use strict";

jest.mock("uuid", () => ({
  v4: jest.fn(() => "11111111-2222-3333-4444-555555555555"),
}));

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../services/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
  deletePattern: jest.fn(),
}));

jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn(),
  getProjectDonationEvents: jest.fn(),
  CONTRACT_ID: "test-contract",
  server: { getTransaction: jest.fn() },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

jest.mock("../services/summaryQueue", () => ({
  enqueueAISummary: jest.fn(),
}));

const pool = require("../db/pool");
const redis = require("../services/redis");
const { getOnChainProject } = require("../services/stellar");
const express = require("express");
const request = require("supertest");
const projectsRouter = require("./projects");

process.env.ADMIN_API_KEY = "test-admin-key";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  app.use((err, _req, res, _next) => {
    res
      .status(err.status || 500)
      .json({ error: err.message || "Internal server error" });
  });
  return app;
}

const MOCK_PROJECT_ROW = {
  id: "proj-1",
  name: "Test Project",
  description: "A test climate project",
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
  tags: ["reforestation", "amazon"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const FOLLOWER_WALLET =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Queue the DB mocks required by GET /api/projects/:id after the project row. */
function mockProjectDetailQueries({
  followCount = 0,
  isFollowing = false,
} = {}) {
  pool.query.mockResolvedValueOnce({ rows: [] }); // campaigns
  pool.query.mockResolvedValueOnce({
    rows: [{ avg_rating: null, count: 0 }],
  }); // ratings
  pool.query.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // subscribers
  pool.query.mockResolvedValueOnce({ rows: [] }); // milestones
  pool.query.mockResolvedValueOnce({
    rows: [{ follow_count: followCount, is_following: isFollowing }],
  }); // follow stats
  getOnChainProject.mockResolvedValue(null);
}

describe("GET /api/projects/:id isFollowing (issue #705)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.resetAllMocks();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null);
    redis.deletePattern.mockResolvedValue(null);
  });

  test("returns isFollowing:false and followCount when walletAddress omitted", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] });
    mockProjectDetailQueries({ followCount: 3, isFollowing: false });

    const res = await request(app).get("/api/projects/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isFollowing).toBe(false);
    expect(res.body.data.followCount).toBe(3);

    const followCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("is_following"),
    );
    expect(followCall).toBeTruthy();
    expect(followCall[1][1]).toBeNull();
  });

  test("returns isFollowing:true when walletAddress follows the project", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] });
    mockProjectDetailQueries({ followCount: 1, isFollowing: true });

    const res = await request(app)
      .get(`/api/projects/proj-1?walletAddress=${FOLLOWER_WALLET}`)
      .expect(200);

    expect(res.body.data.isFollowing).toBe(true);
    expect(res.body.data.followCount).toBe(1);

    const followCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("is_following"),
    );
    expect(followCall).toBeTruthy();
    expect(followCall[0]).toMatch(/EXISTS/);
    expect(followCall[1]).toEqual(["proj-1", FOLLOWER_WALLET]);
  });

  test("returns isFollowing:false when walletAddress does not follow", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] });
    mockProjectDetailQueries({ followCount: 2, isFollowing: false });

    const res = await request(app)
      .get(`/api/projects/proj-1?walletAddress=${FOLLOWER_WALLET}`)
      .expect(200);

    expect(res.body.data.isFollowing).toBe(false);
    expect(res.body.data.followCount).toBe(2);
  });

  test("does not short-circuit with 304 when walletAddress is provided", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] });
    mockProjectDetailQueries({ followCount: 0, isFollowing: false });

    const etag = `"${require("crypto")
      .createHash("md5")
      .update(String(MOCK_PROJECT_ROW.updated_at))
      .digest("hex")}"`;

    const res = await request(app)
      .get(`/api/projects/proj-1?walletAddress=${FOLLOWER_WALLET}`)
      .set("If-None-Match", etag)
      .expect(200);

    expect(res.body.data).toHaveProperty("isFollowing");
  });
});

describe("POST/DELETE /api/projects/:id/follow", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.resetAllMocks();
  });

  test("POST /follow inserts a wallet follow and returns isFollowing:true", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "proj-1" }] }) // project exists
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }); // count

    const res = await request(app)
      .post("/api/projects/proj-1/follow")
      .send({ walletAddress: FOLLOWER_WALLET })
      .expect(200);

    expect(res.body.data).toEqual({ isFollowing: true, followCount: 1 });
    expect(pool.query.mock.calls[1][0]).toMatch(/INSERT INTO project_follows/);
    expect(pool.query.mock.calls[1][1][2]).toBe(FOLLOWER_WALLET);
  });

  test("POST /follows alias works the same as /follow", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "proj-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const res = await request(app)
      .post("/api/projects/proj-1/follows")
      .send({ walletAddress: FOLLOWER_WALLET })
      .expect(200);

    expect(res.body.data.isFollowing).toBe(true);
  });

  test("DELETE /follow removes the wallet follow", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "proj-1" }] })
      .mockResolvedValueOnce({ rows: [] }) // delete
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const res = await request(app)
      .delete("/api/projects/proj-1/follow")
      .send({ walletAddress: FOLLOWER_WALLET })
      .expect(200);

    expect(res.body.data).toEqual({ isFollowing: false, followCount: 0 });
    expect(pool.query.mock.calls[1][0]).toMatch(/DELETE FROM project_follows/);
  });

  test("POST /follow rejects missing walletAddress", async () => {
    await request(app).post("/api/projects/proj-1/follow").send({}).expect(400);
  });
});
