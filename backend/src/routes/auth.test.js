"use strict";
/**
 * src/routes/auth.test.js
 *
 * Tests the wallet-signature authentication flow:
 *   POST /api/auth/challenge → sign a transaction with the challenge memo
 *   → POST /api/auth/token → receive a wallet JWT.
 *
 * Uses a real Stellar keypair and real transaction signing so the
 * verification logic is exercised end-to-end; only the database is mocked.
 */

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));

const {
  Keypair,
  Account,
  Asset,
  Memo,
  Operation,
  TransactionBuilder,
  Networks,
} = require("@stellar/stellar-sdk");
const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const authRouter = require("./auth");

const NETWORK_PASSPHRASE = Networks.TESTNET;
const WALLET = Keypair.random();
const WALLET_ADDRESS = WALLET.publicKey();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

/** Build a real transaction with `nonce` as its text memo, signed by `keypair`. */
function buildSignedTx(keypair, nonce) {
  const source = new Account(keypair.publicKey(), "-1");
  const tx = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        amount: "0.0000001",
        asset: Asset.native(),
      }),
    )
    .addMemo(Memo.text(nonce))
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  return tx.toXDR();
}

/**
 * Mock pool.query for the token endpoint: the SELECT looks the challenge up
 * by its nonce parameter (returning no rows for unknown nonces, like the real
 * query), and the UPDATE (consume) succeeds.
 */
function mockChallengeRow({ nonce, consumed = false, expiresAt } = {}) {
  pool.query.mockImplementation((sql, params) => {
    if (sql.includes("FROM wallet_auth_challenges")) {
      const matches = params && params[0] === nonce;
      return Promise.resolve({
        rows: matches
          ? [
              {
                nonce,
                wallet_address: WALLET_ADDRESS,
                expires_at: expiresAt || new Date(Date.now() + 5 * 60 * 1000),
                consumed_at: consumed ? new Date().toISOString() : null,
              },
            ]
          : [],
      });
    }
    if (sql.includes("UPDATE wallet_auth_challenges")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("POST /api/auth/challenge", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("issues a one-time challenge for a valid wallet address", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/auth/challenge")
      .send({ walletAddress: WALLET_ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.challenge).toBe("string");
    expect(res.body.data.challenge.length).toBeLessThanOrEqual(28); // Stellar text memo limit
    expect(res.body.data.expiresAt).toBeDefined();
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain("INSERT INTO wallet_auth_challenges");
  });

  it("rejects an invalid wallet address", async () => {
    const res = await request(app)
      .post("/api/auth/challenge")
      .send({ walletAddress: "not-a-stellar-address" });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a missing wallet address", async () => {
    const res = await request(app).post("/api/auth/challenge").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/token", () => {
  let app;
  const NONCE = "abc123def456ghi";

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("issues a JWT for a validly signed challenge", async () => {
    mockChallengeRow({ nonce: NONCE });
    const signedXdr = buildSignedTx(WALLET, NONCE);

    const res = await request(app)
      .post("/api/auth/token")
      .send({ walletAddress: WALLET_ADDRESS, signedXdr });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe("string");
    expect(res.body.data.tokenType).toBe("Bearer");
    // The challenge must be consumed so the signed tx cannot be replayed.
    const consumedCall = pool.query.mock.calls.find(([sql]) =>
      sql.includes("UPDATE wallet_auth_challenges"),
    );
    expect(consumedCall).toBeDefined();
  });

  it("rejects a transaction whose memo is not the challenge", async () => {
    mockChallengeRow({ nonce: NONCE });
    const signedXdr = buildSignedTx(WALLET, "wrong-nonce");

    const res = await request(app)
      .post("/api/auth/token")
      .send({ walletAddress: WALLET_ADDRESS, signedXdr });

    expect(res.status).toBe(401);
  });

  it("rejects a transaction signed by a different wallet", async () => {
    mockChallengeRow({ nonce: NONCE });
    const other = Keypair.random();
    const signedXdr = buildSignedTx(other, NONCE);

    const res = await request(app)
      .post("/api/auth/token")
      .send({ walletAddress: WALLET_ADDRESS, signedXdr });

    expect(res.status).toBe(401);
  });

  it("rejects an already-consumed challenge", async () => {
    mockChallengeRow({ nonce: NONCE, consumed: true });
    const signedXdr = buildSignedTx(WALLET, NONCE);

    const res = await request(app)
      .post("/api/auth/token")
      .send({ walletAddress: WALLET_ADDRESS, signedXdr });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/already used/i);
  });

  it("rejects an expired challenge", async () => {
    mockChallengeRow({
      nonce: NONCE,
      expiresAt: new Date(Date.now() - 1000),
    });
    const signedXdr = buildSignedTx(WALLET, NONCE);

    const res = await request(app)
      .post("/api/auth/token")
      .send({ walletAddress: WALLET_ADDRESS, signedXdr });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("rejects a malformed signed transaction", async () => {
    const res = await request(app)
      .post("/api/auth/token")
      .send({ walletAddress: WALLET_ADDRESS, signedXdr: "not-valid-xdr" });

    expect(res.status).toBe(400);
  });

  it("rejects an unknown challenge", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("FROM wallet_auth_challenges")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const signedXdr = buildSignedTx(WALLET, NONCE);

    const res = await request(app)
      .post("/api/auth/token")
      .send({ walletAddress: WALLET_ADDRESS, signedXdr });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unknown challenge/i);
  });
});
