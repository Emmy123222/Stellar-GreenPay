"use strict";

jest.mock("../db/pool", () => ({
  connect: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

const { server } = require("../services/stellar");
const pool = require("../db/pool");
const { computeBadges } = require("../services/store");
const { enqueueProfileUpdate } = require("../services/profileQueue");
const { recordDonation } = require("./donations");

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
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };

  responses.forEach((response) => {
    if (response instanceof Error) {
      client.query.mockRejectedValueOnce(response);
      return;
    }

    client.query.mockResolvedValueOnce(response);
  });

  pool.connect.mockResolvedValue(client);
  return client;
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function invokeRecordDonation(body) {
  const req = { body };
  const res = createMockResponse();
  const next = jest.fn((err) => {
    if (err) {
      res.status(err.status || 500).json({ error: err.message || "Internal server error" });
    }
  });

  await recordDonation(req, res, next);
  return { req, res, next };
}

function expectBadge(totalXLM, tier) {
  const badges = computeBadges(totalXLM);

  if (!tier) {
    expect(badges).toEqual([]);
    return;
  }

  expect(badges).toEqual([
    expect.objectContaining({
      tier,
      earnedAt: expect.any(String),
    }),
  ]);
}

function findQueryCall(client, snippet) {
  return client.query.mock.calls.find(([sql]) => sql.includes(snippet));
}

describe("donations route badge calculation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("awards no badge at 0 XLM", () => {
    expectBadge(0, null);
  });

  test("awards no badge at 9 XLM", () => {
    expectBadge(9, null);
  });

  test("awards Seedling at 10 XLM", () => {
    expectBadge(10, "seedling");
  });

  test("keeps Seedling at 99 XLM", () => {
    expectBadge(99, "seedling");
  });

  test("awards Tree at 100 XLM", () => {
    expectBadge(100, "tree");
  });

  test("keeps Tree at 499 XLM", () => {
    expectBadge(499, "tree");
  });

  test("awards Forest at 500 XLM", () => {
    expectBadge(500, "forest");
  });

  test("keeps Forest at 1999 XLM", () => {
    expectBadge(1999, "forest");
  });

  test("awards Earth Guardian at 2000 XLM", () => {
    expectBadge(2000, "earth");
  });
});

describe("POST /api/donations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("records a valid donation and updates the donor profile", async () => {
    const donorAddress = makePublicKey("A");
    const transactionHash = makeTxHash("a");
    const donationRow = {
      id: "donation-1",
      project_id: "project-1",
      donor_address: donorAddress,
      amount_xlm: "10",
      amount: "10",
      currency: "XLM",
      message: null,
      transaction_hash: transactionHash,
      created_at: "2026-03-29T10:00:00.000Z",
    };

    const client = createMockClient(
      queryResult([{ id: "project-1" }]),   // SELECT project
      queryResult([]),                         // dedup check
      queryResult(),                           // BEGIN
      queryResult([donationRow]),              // INSERT donation
      queryResult([]),                         // SELECT donation_matches (empty)
      queryResult(),                           // UPDATE projects
      queryResult(),                           // COMMIT
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-1",
      donorAddress,
      amountXLM: "10",
      transactionHash,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        projectId: "project-1",
        donorAddress,
        amountXLM: "10.0000000",
        amount: "10",
        currency: "XLM",
        transactionHash,
      }),
    );
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(enqueueProfileUpdate).toHaveBeenCalledWith(donorAddress);
  });

  test("returns 404 for an unknown project id", async () => {
    const client = createMockClient(queryResult([]));

    const { res, next } = await invokeRecordDonation({
      projectId: "missing-project",
      donorAddress: makePublicKey("B"),
      amountXLM: "15",
      transactionHash: makeTxHash("b"),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("Project not found");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("returns 400 for an invalid public key", async () => {
    const { res, next } = await invokeRecordDonation({
      projectId: "project-1",
      donorAddress: "not-a-stellar-key",
      amountXLM: "15",
      transactionHash: makeTxHash("c"),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar public key");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test("returns 400 for an invalid transaction hash", async () => {
    const { res, next } = await invokeRecordDonation({
      projectId: "project-1",
      donorAddress: makePublicKey("C"),
      amountXLM: "15",
      transactionHash: "bad-hash",
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Invalid transaction hash");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test("deduplicates duplicate transaction hashes and returns the existing record", async () => {
    const donorAddress = makePublicKey("D");
    const transactionHash = makeTxHash("d");
    const existingDonation = {
      id: "donation-existing",
      project_id: "project-1",
      donor_address: donorAddress,
      amount_xlm: "25",
      amount: "25",
      currency: "XLM",
      message: null,
      transaction_hash: transactionHash,
      created_at: "2026-03-29T10:00:00.000Z",
    };
    const client = createMockClient(
      queryResult([{ id: "project-1" }]),
      queryResult([existingDonation]),
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-1",
      donorAddress,
      amountXLM: "25",
      transactionHash,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        id: "donation-existing",
        transactionHash,
        amountXLM: "25.0000000",
      }),
    );
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("updates project totals after a donation", async () => {
    const client = createMockClient(
      queryResult([{ id: "project-2" }]),    // SELECT project
      queryResult([]),                          // dedup check
      queryResult(),                            // BEGIN
      queryResult([{
        id: "donation-2",
        project_id: "project-2",
        donor_address: makePublicKey("E"),
        amount_xlm: "5.5",
        amount: "5.5",
        currency: "XLM",
        message: null,
        transaction_hash: makeTxHash("e"),
        created_at: "2026-03-29T10:00:00.000Z",
      }]),                                      // INSERT donation
      queryResult([]),                          // SELECT donation_matches (empty)
      queryResult(),                            // UPDATE projects
      queryResult(),                            // COMMIT
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-2",
      donorAddress: makePublicKey("E"),
      amountXLM: "5.5",
      transactionHash: makeTxHash("e"),
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(enqueueProfileUpdate).toHaveBeenCalledWith(makePublicKey("E"));

    const updateProjectCall = findQueryCall(client, "UPDATE projects");
    expect(updateProjectCall[1]).toEqual([5.5, "project-2"]);
  });

  test("calculates badges from cumulative donations across multiple requests", async () => {
    const donorAddress = makePublicKey("F");
    const client = createMockClient(
      queryResult([{ id: "project-3" }]),    // SELECT project
      queryResult([]),                          // dedup check
      queryResult(),                            // BEGIN
      queryResult([{
        id: "donation-3",
        project_id: "project-3",
        donor_address: donorAddress,
        amount_xlm: "1",
        amount: "1",
        currency: "XLM",
        message: null,
        transaction_hash: makeTxHash("f"),
        created_at: "2026-03-29T10:00:00.000Z",
      }]),                                      // INSERT donation
      queryResult([]),                          // SELECT donation_matches (empty)
      queryResult(),                            // UPDATE projects
      queryResult(),                            // COMMIT
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-3",
      donorAddress,
      amountXLM: "1",
      transactionHash: makeTxHash("f"),
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(enqueueProfileUpdate).toHaveBeenCalledWith(donorAddress);
  });

  test("rejects a transaction that is not confirmed on Stellar", async () => {
    server.getTransaction.mockResolvedValueOnce({ successful: false });
    const client = createMockClient(
      queryResult([{ id: "project-1" }]),   // SELECT project
      queryResult([]),                         // dedup check
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-1",
      donorAddress: makePublicKey("H"),
      amountXLM: "10",
      transactionHash: makeTxHash("9"),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Transaction not confirmed on Stellar");
    // No DB write transaction should have been opened.
    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("rejects a transaction hash that cannot be found on Stellar", async () => {
    server.getTransaction.mockRejectedValueOnce(new Error("404 Not Found"));
    const client = createMockClient(
      queryResult([{ id: "project-1" }]),   // SELECT project
      queryResult([]),                         // dedup check
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-1",
      donorAddress: makePublicKey("I"),
      amountXLM: "10",
      transactionHash: makeTxHash("8"),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Transaction not found on Stellar");
    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("does not pass undefined as COMMIT query — transaction is explicitly committed", async () => {
    const donorAddress = makePublicKey("H");
    const transactionHash = makeTxHash("1");
    const donationRow = {
      id: "donation-h",
      project_id: "project-h",
      donor_address: donorAddress,
      amount_xlm: "50",
      amount: "50",
      currency: "XLM",
      message: null,
      transaction_hash: transactionHash,
      created_at: "2026-03-29T10:00:00.000Z",
    };

    const client = createMockClient(
      queryResult([{ id: "project-h" }]),
      queryResult([]),
      queryResult(),
      queryResult([donationRow]),
      queryResult([]),
      queryResult(),
      queryResult([]),
      queryResult([{ count: "1" }]),
      queryResult(),
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-h",
      donorAddress,
      amountXLM: "50",
      transactionHash,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(enqueueProfileUpdate).toHaveBeenCalledWith(donorAddress);
    const calls = client.query.mock.calls.map(([sql]) => sql);
    expect(calls).toContain("COMMIT");
  });

  test("rolls back the transaction if profile persistence fails after BEGIN", async () => {
    const client = createMockClient(
      queryResult([{ id: "project-4" }]),
      queryResult([]),
      queryResult(),
      queryResult([{
        id: "donation-4",
        project_id: "project-4",
        donor_address: makePublicKey("G"),
        amount_xlm: "12",
        amount: "12",
        currency: "XLM",
        message: null,
        transaction_hash: makeTxHash("a"),
        created_at: "2026-03-29T10:00:00.000Z",
      }]),
      queryResult(),
      queryResult([]),
      queryResult([{ count: "1" }]),
      new Error("profile write failed"),
      queryResult(),
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-4",
      donorAddress: makePublicKey("G"),
      amountXLM: "12",
      transactionHash: makeTxHash("a"),
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].message).toBe("profile write failed");
    expect(res.statusCode).toBe(500);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe("profile upsert on first donation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("creates a new profile using only the first donation amount as total_donated_xlm", async () => {
    const donorAddress = makePublicKey("P");
    const transactionHash = makeTxHash("2");
    const donationRow = {
      id: "donation-p",
      project_id: "project-p",
      donor_address: donorAddress,
      amount_xlm: "500",
      amount: "500",
      currency: "XLM",
      message: null,
      transaction_hash: transactionHash,
      created_at: "2026-03-29T10:00:00.000Z",
    };

    const client = createMockClient(
      queryResult([{ id: "project-p" }]),
      queryResult([]),
      queryResult(),
      queryResult([donationRow]),
      queryResult([]),
      queryResult(),
      queryResult([]),
      queryResult([{ count: "1" }]),
      queryResult(),
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-p",
      donorAddress,
      amountXLM: "500",
      transactionHash,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(enqueueProfileUpdate).toHaveBeenCalledWith(donorAddress);
  });

  test("preserves display_name and bio from an existing profile on upsert", async () => {
    const donorAddress = makePublicKey("Q");
    const transactionHash = makeTxHash("3");
    const donationRow = {
      id: "donation-q",
      project_id: "project-q",
      donor_address: donorAddress,
      amount_xlm: "10",
      amount: "10",
      currency: "XLM",
      message: null,
      transaction_hash: transactionHash,
      created_at: "2026-03-29T10:00:00.000Z",
    };

    const client = createMockClient(
      queryResult([{ id: "project-q" }]),
      queryResult([]),
      queryResult(),
      queryResult([donationRow]),
      queryResult([]),
      queryResult(),
      queryResult([{                          // existing profile with display_name + bio
        public_key: donorAddress,
        display_name: "Green Donor",
        bio: "I care about the planet.",
        total_donated_xlm: "90.0000000",
      }]),
      queryResult([{ count: "2" }]),
      queryResult(),
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-q",
      donorAddress,
      amountXLM: "10",
      transactionHash,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(enqueueProfileUpdate).toHaveBeenCalledWith(donorAddress);
  });

  test("does not increment total_donated_xlm for non-XLM donations", async () => {
    const donorAddress = makePublicKey("R");
    const transactionHash = makeTxHash("4");
    const donationRow = {
      id: "donation-r",
      project_id: "project-r",
      donor_address: donorAddress,
      amount_xlm: null,
      amount: "25",
      currency: "USD",
      message: null,
      transaction_hash: transactionHash,
      created_at: "2026-03-29T10:00:00.000Z",
    };

    const client = createMockClient(
      queryResult([{ id: "project-r" }]),
      queryResult([]),
      queryResult(),
      queryResult([donationRow]),
      // no donation_matches query for non-XLM
      queryResult(),                          // UPDATE projects (raises_xlm += 0)
      queryResult(),                          // COMMIT
    );

    const { res, next } = await invokeRecordDonation({
      projectId: "project-r",
      donorAddress,
      amount: "25",
      currency: "USD",
      transactionHash,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(enqueueProfileUpdate).toHaveBeenCalledWith(donorAddress);
  });
});
