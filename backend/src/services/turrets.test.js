/**
 * src/services/turrets.test.js - unit tests for the Turrets matching service
 *
 * Boots the Express app on an ephemeral port and drives it with supertest.
 * Nothing here touches the network or the database:
 *   - @stellar/stellar-sdk is replaced with a jest mock, so Horizon/RPC calls
 *     (loadAccount, submitTransaction) are stubs and Keypair.fromSecret is a
 *     deterministic fake,
 *   - ../db/pool is the usual mocked query,
 *   - ../middleware/auth is mocked so /admin/presign does not depend on real
 *     JWT/wallet middleware or the pool it would otherwise need.
 *
 * The HTTP listener is closed in afterAll so jest exits without --forceExit.
 */
"use strict";

// ── Module mocks (must run before any require of the modules under test) ──

jest.mock("../db/pool", () => ({ query: jest.fn() }));

jest.mock("../middleware/auth", () => ({
  // Pass-through: an authenticated admin for every request in this suite.
  // The suite is not about auth, it is about what happens once authorised.
  adminKeyRequired: (req, res, next) => next(),
}));

const mockServerInstance = {
  _url: "https://horizon-testnet.stellar.org",
  loadAccount: jest.fn(),
  submitTransaction: jest.fn(),
};

jest.mock("@stellar/stellar-sdk", () => {
  const Keypair = {
    fromSecret: jest.fn((secret) => ({
      _secret: secret,
      publicKey: () => "GMATCHERFAKEPUBLICKEY000000000000000000000000000000000000",
      sign: jest.fn(),
    })),
  };

  // Chainable TransactionBuilder fake: every builder method returns `this`,
  // and build() returns a fake Transaction whose sign()/toXDR() are spies.
  function makeBuilder() {
    const tx = {
      sign: jest.fn(),
      toXDR: jest.fn(() => "AAAA_FAKE_XDR"),
    };
    const builder = {
      addOperation: jest.fn().mockReturnThis(),
      addMemo: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => tx),
    };
    return builder;
  }

  return {
    Server: jest.fn().mockImplementation((url) => {
      mockServerInstance._url = url;
      return mockServerInstance;
    }),
    TransactionBuilder: jest.fn().mockImplementation(() => makeBuilder()),
    Networks: { PUBLIC: "Public Global Stellar Network ; September 2015", TESTNET: "Test SDF Network ; September 2015" },
    Operation: {
      payment: jest.fn((opts) => ({ _type: "payment", ...opts })),
      memo: jest.fn((opts) => ({ _type: "memo", ...opts })),
    },
    Asset: { native: jest.fn(() => ({ _type: "native" })) },
    Keypair,
    Horizon: {},
  };
});

const request = require("supertest");
const sdk = require("@stellar/stellar-sdk");
const pool = require("../db/pool");

const {
  startTurretsServer,
  matchDonationTxFunction,
  submitMatchingPayment,
  generatePreSignedTransactions,
} = require("./turrets");

// ── Env isolation ─────────────────────────────────────────────────────────

const ENV_KEYS = ["STELLAR_NETWORK", "HORIZON_URL", "MATCHER_SECRET_KEY"];
const SAVED_ENV = {};

beforeAll(() => {
  ENV_KEYS.forEach((key) => { SAVED_ENV[key] = process.env[key]; });
});

afterAll(() => {
  Object.entries(SAVED_ENV).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockReset();
  delete process.env.MATCHER_SECRET_KEY;
  // Each test that exercises loadAccount/submitTransaction must set these
  // on the freshly-mocked Server instance created by getServer(). The
  // module-level `server` in turrets.js is lazy-cached, so we grab the
  // instance the module actually holds via require("./turrets").__getServer.
});

// ── Server lifecycle ──────────────────────────────────────────────────────

let app;
let httpServer;

beforeAll((done) => {
  // Port 0 → OS picks an ephemeral port, avoiding collisions with anything
  // the dev is running on 3001. We do not need the port number itself for
  // supertest (it hits the app in-process), but the listener must be live.
  const started = startTurretsServer(0);
  app = started.app;
  httpServer = started.server;
  if (httpServer.listening) return done();
  httpServer.once("listening", done);
});

afterAll((done) => {
  if (httpServer && httpServer.listening) {
    httpServer.close(() => done());
  } else {
    done();
  }
});

// Helper to reach into the module's lazily-cached Horizon Server stub, which
// is the one used by submitMatchingPayment and generatePreSignedTransactions.
function horizonStub() {
  const instances = sdk.Server.mock.results ? sdk.Server.mock.results.map((r) => r.value).filter(Boolean) : [];
  return instances[instances.length - 1] || mockServerInstance;
}

// ═════════════════════════════════════════════════════════════════════════
// Server boot
// ═════════════════════════════════════════════════════════════════════════

describe("startTurretsServer", () => {
  test("boots an HTTP listener and returns both the app and the server", () => {
    expect(app).toBeDefined();
    expect(typeof app).toBe("function"); // express app is callable
    expect(httpServer).toBeDefined();
    expect(httpServer.listening).toBe(true);
  });

  test("GET /health reports the service identity", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "turrets-matching" });
  });

  test("unknown route returns express default 404", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// /txfunction/matchDonation
// ═════════════════════════════════════════════════════════════════════════

describe("POST /txfunction/matchDonation", () => {
  test("rejects a non-XLM donation without touching the DB", async () => {
    const res = await request(app)
      .post("/txfunction/matchDonation")
      .send({ to: "G...", amount: "10", asset_type: "credit_alphanum4", asset_code: "USDC" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matched: false, reason: "Not an XLM donation" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("returns 'Project not found' when no project matches the wallet", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/txfunction/matchDonation")
      .send({ to: "GNOPROJECTWALLET", amount: "25", asset_type: "native" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matched: false, reason: "Project not found" });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("returns 'No active matching offers' when the project has none", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "proj-1", name: "Mangroves" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/txfunction/matchDonation")
      .send({ to: "GWALLET", amount: "25", asset_type: "native", transaction_hash: "abcd" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matched: false, reason: "No active matching offers" });
  });

  test("processes a matching offer end-to-end", async () => {
    // 1st query: project lookup
    pool.query.mockResolvedValueOnce({ rows: [{ id: "proj-1", name: "Mangroves" }] });
    // 2nd query: matching offers
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "match-1", matcher_address: "GMATCHER", cap_xlm: "100", matched_xlm: "0", multiplier: 2 }],
    });
    // 3rd query: UPDATE donation_matches
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    // 4th query: INSERT donations
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    // Arrange the matcher secret so submitMatchingPayment proceeds past the guard.
    process.env.MATCHER_SECRET_KEY = "SFAKEMATCHERSECRET";
    horizonStub().loadAccount.mockResolvedValueOnce({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });
    horizonStub().submitTransaction.mockResolvedValueOnce({ hash: "FAKE_TX_HASH" });

    const res = await request(app)
      .post("/txfunction/matchDonation")
      .send({
        to: "GWALLET",
        from: "GDONOR",
        amount: "25",
        asset_type: "native",
        transaction_hash: "ORIGINAL_HASH",
      });

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(true);
    expect(res.body.totalMatched).toBe(50); // 25 * 2, cap 100
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0]).toMatchObject({ matchId: "match-1", amount: 50, txHash: "FAKE_TX_HASH" });
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  test("returns 200 with matched:false when the txFunction itself throws", async () => {
    // Force an unexpected error inside the tx function (e.g. pool explodes).
    pool.query.mockRejectedValueOnce(new Error("DB is on fire"));

    const res = await request(app)
      .post("/txfunction/matchDonation")
      .send({ to: "GWALLET", amount: "10", asset_type: "native" });

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
    expect(res.body.error).toMatch(/DB is on fire/);
  });

  test("caps the match at the offer's remaining headroom", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "proj-1", name: "Mangroves" }] });
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "match-1", matcher_address: "GMATCHER", cap_xlm: "100", matched_xlm: "95", multiplier: 2 }],
    });
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // INSERT

    process.env.MATCHER_SECRET_KEY = "SFAKEMATCHERSECRET";
    horizonStub().loadAccount.mockResolvedValueOnce({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });
    horizonStub().submitTransaction.mockResolvedValueOnce({ hash: "HASH" });

    const res = await request(app)
      .post("/txfunction/matchDonation")
      .send({ to: "GWALLET", from: "GDONOR", amount: "25", asset_type: "native", transaction_hash: "H" });

    // 25 * 2 = 50, but only 5 XLM remain under the cap.
    expect(res.body.totalMatched).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// /admin/presign
// ═════════════════════════════════════════════════════════════════════════

describe("POST /admin/presign", () => {
  test("400 when required body params are missing", async () => {
    const res = await request(app).post("/admin/presign").send({ matcherAddress: "G..." });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required parameters/);
  });

  test("returns generated transactions for a valid request", async () => {
    horizonStub().loadAccount.mockResolvedValue({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });

    const res = await request(app)
      .post("/admin/presign")
      .send({
        matcherAddress: "GMATCHER",
        matcherSecret: "SFAKEMATCHERSECRET",
        projectWallet: "GPROJECT",
        capXlm: "500",
        multiplier: 2,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    // The five donation tiers (10,25,50,100,250) each produce one tx.
    expect(res.body.transactions).toHaveLength(5);
    expect(res.body.transactions[0]).toMatchObject({
      donationAmount: 10,
      matchAmount: 20,
      xdr: "AAAA_FAKE_XDR",
    });
  });

  test("500 when the underlying generator throws", async () => {
    // Force Keypair.fromSecret to blow up for this test only.
    sdk.Keypair.fromSecret.mockImplementationOnce(() => { throw new Error("bad secret"); });

    const res = await request(app)
      .post("/admin/presign")
      .send({
        matcherAddress: "GMATCHER",
        matcherSecret: "NOT_A_SECRET",
        projectWallet: "GPROJECT",
        capXlm: "100",
        multiplier: 1,
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/bad secret/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// submitMatchingPayment - misconfiguration + happy path
// ═════════════════════════════════════════════════════════════════════════

describe("submitMatchingPayment", () => {
  test("short-circuits with reason when MATCHER_SECRET_KEY is not configured", async () => {
    // No MATCHER_SECRET_KEY set (beforeEach cleared it).
    horizonStub().loadAccount.mockResolvedValueOnce({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });

    const result = await submitMatchingPayment({
      matcherAddress: "GMATCHER",
      projectWallet: "GPROJECT",
      amount: 10,
      originalTxHash: "HASH_HASH_HASH_HASH_HASH_HASH",
      matchId: "m1",
      projectId: "p1",
    });

    expect(result).toEqual({ success: false, reason: "Matcher secret not configured" });
    expect(horizonStub().submitTransaction).not.toHaveBeenCalled();
  });

  test("returns the submitted transaction hash on success", async () => {
    process.env.MATCHER_SECRET_KEY = "SFAKEMATCHERSECRET";
    horizonStub().loadAccount.mockResolvedValueOnce({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });
    horizonStub().submitTransaction.mockResolvedValueOnce({ hash: "TX_OK" });

    const result = await submitMatchingPayment({
      matcherAddress: "GMATCHER",
      projectWallet: "GPROJECT",
      amount: 10,
      originalTxHash: "HASH_HASH_HASH_HASH_HASH_HASH",
      matchId: "m1",
      projectId: "p1",
    });

    expect(result).toEqual({ success: true, txHash: "TX_OK" });
    expect(sdk.Keypair.fromSecret).toHaveBeenCalledWith("SFAKEMATCHERSECRET");
    expect(horizonStub().submitTransaction).toHaveBeenCalledTimes(1);
  });

  test("captures Horizon submission errors instead of throwing", async () => {
    process.env.MATCHER_SECRET_KEY = "SFAKEMATCHERSECRET";
    horizonStub().loadAccount.mockResolvedValueOnce({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });
    horizonStub().submitTransaction.mockRejectedValueOnce(new Error("tx_too_late"));

    const result = await submitMatchingPayment({
      matcherAddress: "GMATCHER",
      projectWallet: "GPROJECT",
      amount: 10,
      originalTxHash: "HASH_HASH_HASH_HASH_HASH_HASH",
      matchId: "m1",
      projectId: "p1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tx_too_late/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// generatePreSignedTransactions
// ═════════════════════════════════════════════════════════════════════════

describe("generatePreSignedTransactions", () => {
  test("skips tiers whose match amount exceeds the cap", async () => {
    horizonStub().loadAccount.mockResolvedValue({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });

    const txs = await generatePreSignedTransactions({
      matcherAddress: "GMATCHER",
      matcherSecret: "SFAKEMATCHERSECRET",
      projectWallet: "GPROJECT",
      capXlm: 30, // 10*2=20 ok, 25*2=50 > 30 → skipped
      multiplier: 2,
      projectId: "p1",
    });

    // Only the 10-XLM tier fits under the cap.
    expect(txs.map((t) => t.donationAmount)).toEqual([10]);
  });

  test("returns an empty array when the cap is zero", async () => {
    horizonStub().loadAccount.mockResolvedValue({ accountId: () => "GMATCHER", sequenceNumber: () => "1" });

    const txs = await generatePreSignedTransactions({
      matcherAddress: "GMATCHER",
      matcherSecret: "SFAKEMATCHERSECRET",
      projectWallet: "GPROJECT",
      capXlm: 0,
      multiplier: 1,
      projectId: "p1",
    });

    expect(txs).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Direct call - matchDonationTxFunction
// ═════════════════════════════════════════════════════════════════════════

describe("matchDonationTxFunction (direct)", () => {
  test("does not throw on a null payment; returns matched:false", async () => {
    const result = await matchDonationTxFunction(null);
    expect(result.matched).toBe(false);
    expect(result.error).toBeDefined();
  });
});