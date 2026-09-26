"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));

const pool = require("../db/pool");
const request = require("supertest");
const express = require("express");
const jobsRouter = require("./jobs");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/jobs", jobsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures — four jobs covering all relevant statuses and two distinct clients
// ---------------------------------------------------------------------------

const CLIENT_A = "GBVNQON4MFVGJXK5WT7VQJJZXFVHZJB6BHFWJCW7OF5BLNGOLZJQHIY";
const CLIENT_B = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP";

function makeJob(overrides) {
  return {
    id: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
    title: "Test job",
    description: "Test description",
    client_public_key: CLIENT_A,
    freelancer_public_key: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    amount_escrow_xlm: "50.0000000",
    status: "in_escrow",
    release_transaction_hash: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

const JOB_IN_ESCROW_A = makeJob({
  id: "job-001",
  title: "Climate dashboard UI",
  status: "in_escrow",
  client_public_key: CLIENT_A,
});

const JOB_COMPLETED_A = makeJob({
  id: "job-002",
  title: "Smart contract audit",
  status: "completed",
  client_public_key: CLIENT_A,
  release_transaction_hash: "a".repeat(64),
});

const JOB_OPEN_B = makeJob({
  id: "job-003",
  title: "Mobile app design",
  status: "open",
  client_public_key: CLIENT_B,
});

const JOB_IN_ESCROW_B = makeJob({
  id: "job-004",
  title: "Backend API",
  status: "in_escrow",
  client_public_key: CLIENT_B,
});

// ---------------------------------------------------------------------------

describe("GET /api/jobs — status filter", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns only in_escrow and completed jobs when status=in_escrow|completed", async () => {
    // DB returns the rows that match the status filter; 'open' job is excluded
    pool.query.mockResolvedValue({
      rows: [JOB_IN_ESCROW_A, JOB_COMPLETED_A, JOB_IN_ESCROW_B],
    });

    const res = await request(app)
      .get("/api/jobs?status=in_escrow|completed")
      .expect(200);

    expect(res.body.success).toBe(true);
    const statuses = res.body.data.map((j) => j.status);
    expect(statuses).not.toContain("open");
    expect(statuses.every((s) => ["in_escrow", "completed"].includes(s))).toBe(true);
  });

  test("does not return the open job when status=in_escrow|completed", async () => {
    pool.query.mockResolvedValue({
      rows: [JOB_IN_ESCROW_A, JOB_COMPLETED_A, JOB_IN_ESCROW_B],
    });

    const res = await request(app)
      .get("/api/jobs?status=in_escrow|completed")
      .expect(200);

    const ids = res.body.data.map((j) => j.id);
    expect(ids).not.toContain(JOB_OPEN_B.id);
  });

  test("passes the parsed status array to pool.query", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/jobs?status=in_escrow|completed").expect(200);

    const [, values] = pool.query.mock.calls[0];
    expect(values[0]).toEqual(["in_escrow", "completed"]);
  });

  test("returns all jobs when no status filter is provided", async () => {
    pool.query.mockResolvedValue({
      rows: [JOB_IN_ESCROW_A, JOB_COMPLETED_A, JOB_OPEN_B, JOB_IN_ESCROW_B],
    });

    const res = await request(app).get("/api/jobs").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/jobs — clientPublicKey filter", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns only Client A jobs when clientPublicKey=CLIENT_A", async () => {
    pool.query.mockResolvedValue({ rows: [JOB_IN_ESCROW_A, JOB_COMPLETED_A] });

    const res = await request(app)
      .get(`/api/jobs?clientPublicKey=${CLIENT_A}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    res.body.data.forEach((j) => {
      expect(j.clientPublicKey).toBe(CLIENT_A);
    });
  });

  test("does not return Client B jobs when filtering by Client A", async () => {
    pool.query.mockResolvedValue({ rows: [JOB_IN_ESCROW_A, JOB_COMPLETED_A] });

    const res = await request(app)
      .get(`/api/jobs?clientPublicKey=${CLIENT_A}`)
      .expect(200);

    const keys = res.body.data.map((j) => j.clientPublicKey);
    expect(keys).not.toContain(CLIENT_B);
  });

  test("passes clientPublicKey as a query parameter to pool.query", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app)
      .get(`/api/jobs?clientPublicKey=${CLIENT_A}`)
      .expect(200);

    const [, values] = pool.query.mock.calls[0];
    expect(values).toContain(CLIENT_A);
  });

  test("returns an empty array when no jobs exist for the given client", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get(`/api/jobs?clientPublicKey=${CLIENT_B}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/jobs — status + clientPublicKey combined filter", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns only Client A in_escrow jobs when both filters are applied", async () => {
    // DB returns only the intersection: Client A + in_escrow
    pool.query.mockResolvedValue({ rows: [JOB_IN_ESCROW_A] });

    const res = await request(app)
      .get(`/api/jobs?status=in_escrow|completed&clientPublicKey=${CLIENT_A}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(JOB_IN_ESCROW_A.id);
    expect(res.body.data[0].clientPublicKey).toBe(CLIENT_A);
    expect(res.body.data[0].status).toBe("in_escrow");
  });

  test("excludes Client B jobs when clientPublicKey is Client A", async () => {
    pool.query.mockResolvedValue({ rows: [JOB_IN_ESCROW_A] });

    const res = await request(app)
      .get(`/api/jobs?status=in_escrow|completed&clientPublicKey=${CLIENT_A}`)
      .expect(200);

    const keys = res.body.data.map((j) => j.clientPublicKey);
    expect(keys).not.toContain(CLIENT_B);
  });

  test("excludes open jobs when status filter is in_escrow|completed", async () => {
    pool.query.mockResolvedValue({ rows: [JOB_IN_ESCROW_A] });

    const res = await request(app)
      .get(`/api/jobs?status=in_escrow|completed&clientPublicKey=${CLIENT_A}`)
      .expect(200);

    const statuses = res.body.data.map((j) => j.status);
    expect(statuses).not.toContain("open");
  });

  test("passes both status array and clientPublicKey to pool.query", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app)
      .get(`/api/jobs?status=in_escrow|completed&clientPublicKey=${CLIENT_A}`)
      .expect(200);

    const [, values] = pool.query.mock.calls[0];
    expect(values[0]).toEqual(["in_escrow", "completed"]);
    expect(values[1]).toBe(CLIENT_A);
  });

  test("returns empty array when no jobs match both filters", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get(`/api/jobs?status=completed&clientPublicKey=${CLIENT_B}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/jobs — response shape", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("maps snake_case DB fields to camelCase in the response", async () => {
    pool.query.mockResolvedValue({ rows: [JOB_IN_ESCROW_A] });

    const res = await request(app).get("/api/jobs").expect(200);
    const job = res.body.data[0];

    expect(job).toMatchObject({
      id: JOB_IN_ESCROW_A.id,
      title: JOB_IN_ESCROW_A.title,
      clientPublicKey: CLIENT_A,
      status: "in_escrow",
      releaseTransactionHash: null,
    });
  });

  test("sets releaseTransactionHash on completed jobs", async () => {
    pool.query.mockResolvedValue({ rows: [JOB_COMPLETED_A] });

    const res = await request(app).get("/api/jobs").expect(200);

    expect(res.body.data[0].releaseTransactionHash).toBe("a".repeat(64));
  });
});
