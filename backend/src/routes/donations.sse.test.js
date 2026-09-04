"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));
jest.mock("../services/profileQueue", () => ({
  enqueueProfileUpdate: jest.fn().mockResolvedValue(undefined),
}));

const http = require("http");
const express = require("express");
const supertest = require("supertest");
const pool = require("../db/pool");

function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}

function makeTxHash(char = "a") {
  return char.repeat(64);
}

function queryResult(rows = []) {
  return { rows };
}

function createMockClient(...responses) {
  const client = { query: jest.fn(), release: jest.fn() };
  responses.forEach((r) => {
    if (r instanceof Error) {
      client.query.mockRejectedValueOnce(r);
    } else {
      client.query.mockResolvedValueOnce(r);
    }
  });
  pool.connect.mockResolvedValue(client);
  return client;
}

/**
 * Open a single SSE connection. `initialPromise` resolves once the stream's
 * initial frame arrives (at which point the server has registered this
 * connection as a subscriber), and `donationPromise` resolves with the parsed
 * payload of the next `event: donation` frame.
 */
function openSseConnection(baseUrl) {
  let resolveInitial;
  let resolveDonation;
  const initialPromise = new Promise((resolve) => {
    resolveInitial = resolve;
  });
  const donationPromise = new Promise((resolve) => {
    resolveDonation = resolve;
  });

  const chunks = [];
  let sawInitial = false;
  const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
    res.on("error", () => {});
    res.on("data", (chunk) => {
      chunks.push(chunk.toString());
      const full = chunks.join("");
      if (!sawInitial && full.includes("event: initial")) {
        sawInitial = true;
        resolveInitial();
      }
      const match = full.match(/event: donation\ndata: ({.*})\n\n/);
      if (match) {
        req.destroy();
        resolveDonation(JSON.parse(match[1]));
      }
    });
    res.on("end", () => {});
  });
  req.on("error", () => {});

  return { req, initialPromise, donationPromise, destroy: () => req.destroy() };
}

describe("GET /api/donations/stream", () => {
  let httpServer;
  let baseUrl;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    httpServer = http.createServer(app);
    app.use("/api/donations", require("./donations"));
    httpServer.listen(0, () => {
      baseUrl = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    httpServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test("returns correct SSE headers", (done) => {
    const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
      expect(res.headers["connection"]).toBe("keep-alive");
      expect(res.headers["x-accel-buffering"]).toBe("no");
      res.destroy();
      done();
    });
    req.on("error", done);
  });

  test("sends an initial event with recent donations", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: "don-1",
          project_id: "proj-1",
          donor_address: makePublicKey(),
          amount_xlm: "10.0000000",
          amount: "10",
          currency: "XLM",
          message: "Nice!",
          transaction_hash: makeTxHash("a"),
          created_at: new Date().toISOString(),
          project_name: "Amazon Reforestation",
        },
      ],
    });

    const received = await new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
        const chunks = [];
        res.on("error", reject);
        res.on("data", (chunk) => {
          chunks.push(chunk.toString());
          const match = chunks.join("").match(/event: initial\ndata: ({.*})\n\n/);
          if (match) {
            req.destroy();
            resolve(JSON.parse(match[1]));
          }
        });
        res.on("end", () => reject(new Error("stream ended before initial event")));
      });
      req.on("error", reject);
    });

    expect(received.donations).toHaveLength(1);
    expect(received.donations[0].projectName).toBe("Amazon Reforestation");
    expect(received.donations[0].amountXLM).toBe("10.0000000");
  });
});

describe("POST /api/donations → SSE emission", () => {
  let httpServer;
  let baseUrl;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    httpServer = http.createServer(app);
    app.use("/api/donations", require("./donations"));
    httpServer.listen(0, () => {
      baseUrl = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    httpServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test("POST /api/donations broadcasts an SSE event with projectName and amountXLM", async () => {
    const donorAddress = makePublicKey("W");
    const transactionHash = makeTxHash("7");
    const donationRow = {
      id: "sse-donation-1",
      project_id: "project-sse",
      donor_address: donorAddress,
      amount_xlm: "25",
      amount: "25",
      currency: "XLM",
      message: null,
      transaction_hash: transactionHash,
      created_at: new Date().toISOString(),
    };

    createMockClient(
      queryResult([{ id: "project-sse", name: "Amazon Reforestation" }]), // SELECT project
      queryResult([]), // dedup check
      queryResult(), // BEGIN
      queryResult([{ total: "0" }]), // previous total donated
      queryResult([donationRow]), // INSERT donation
      queryResult([]), // SELECT donation_matches (empty)
      queryResult(), // UPDATE projects
      queryResult(), // COMMIT
    );

    const conn = openSseConnection(baseUrl);
    await conn.initialPromise;

    const res = await supertest(httpServer)
      .post("/api/donations")
      .send({
        projectId: "project-sse",
        donorAddress,
        amountXLM: "25",
        transactionHash,
      })
      .expect(201);

    expect(res.body.success).toBe(true);

    const data = await conn.donationPromise;
    expect(data.donation.projectName).toBe("Amazon Reforestation");
    expect(data.donation.amountXLM).toBe("25.0000000");
    expect(data.donation.donorAddress).toBe(donorAddress);
    conn.destroy();
  });

  test("SSE event for large donation includes the correct amount", async () => {
    const donorAddress = makePublicKey("V");
    const transactionHash = makeTxHash("a");
    const donationRow = {
      id: "sse-donation-2",
      project_id: "project-big",
      donor_address: donorAddress,
      amount_xlm: "500",
      amount: "500",
      currency: "XLM",
      message: null,
      transaction_hash: transactionHash,
      created_at: new Date().toISOString(),
    };

    createMockClient(
      queryResult([{ id: "project-big", name: "Amazon Reforestation" }]),
      queryResult([]),
      queryResult(),
      queryResult([{ total: "0" }]),
      queryResult([donationRow]),
      queryResult([]),
      queryResult(),
      queryResult(),
    );

    const conn = openSseConnection(baseUrl);
    await conn.initialPromise;

    await supertest(httpServer)
      .post("/api/donations")
      .send({
        projectId: "project-big",
        donorAddress,
        amountXLM: "500",
        transactionHash,
      })
      .expect(201);

    const data = await conn.donationPromise;
    expect(data.donation.projectName).toBe("Amazon Reforestation");
    expect(data.donation.amountXLM).toBe("500.0000000");
    conn.destroy();
  });
});
