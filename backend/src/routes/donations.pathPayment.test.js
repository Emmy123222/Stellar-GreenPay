"use strict";
/**
 * POST /api/donations — DEX path-payment donations (#1660).
 *
 * The recorded currency/amount must come from what Horizon says the project
 * wallet received, not from the request body; the source asset/amount are
 * stored alongside. Projects with a preferred asset are always verified.
 */

jest.mock("../db/pool", () => ({
  connect: jest.fn(),
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
  getDeliveredPayment: jest.fn(),
}));
jest.mock("geoip-lite", () => ({ lookup: jest.fn() }));
jest.mock("../services/profileQueue", () => ({
  enqueueProfileUpdate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/webhook", () => ({
  checkAndDeliverMilestones: jest.fn().mockResolvedValue(undefined),
}));
// pg-boss backed queue — ESM-only, not loadable under this Jest config.
jest.mock("../services/donationPushQueue", () => ({
  enqueueDonationPushNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/redis", () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  deletePattern: jest.fn(async () => {}),
}));

const pool = require("../db/pool");
const stellar = require("../services/stellar");
const { recordDonation } = require("./donations");

const DONOR = `G${"D".repeat(55)}`;
const PROJECT_WALLET = `G${"P".repeat(55)}`;
const ISSUER = `G${"I".repeat(55)}`;
const TX = "f".repeat(64);

function mockClient({ preferred = null } = {}) {
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (/FROM projects WHERE id/.test(sql)) {
        return {
          rows: [{
            id: "proj-1",
            name: "Mangroves",
            co2_per_xlm: 100,
            wallet_address: PROJECT_WALLET,
            preferred_asset_code: preferred ? preferred.code : null,
            preferred_asset_issuer: preferred ? preferred.issuer : null,
          }],
        };
      }
      if (/INSERT INTO donations/.test(sql)) return { rows: [{ id: "don-1", project_id: "proj-1" }] };
      if (/SUM\(amount_xlm\)/.test(sql)) return { rows: [{ total: "0" }] };
      if (/FROM profiles/.test(sql)) return { rows: [] };
      if (/COUNT\(DISTINCT project_id\)/.test(sql)) return { rows: [{ count: "1" }] };
      return { rows: [] };
    }),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

async function invoke(body) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const next = jest.fn((err) => {
    if (err) res.status(err.status || 500).json({ error: err.message, code: err.code });
  });
  await recordDonation({ body, ip: "127.0.0.1", app: { get: () => null } }, res, next);
  return res;
}

function insertParams(client) {
  const call = client.query.mock.calls.find(([sql]) => /INSERT INTO donations/.test(sql));
  return call && call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

describe("path-payment donations", () => {
  it("records the delivered USDC amount, not the client-reported amount", async () => {
    const client = mockClient({ preferred: { code: "USDC", issuer: ISSUER } });
    stellar.getDeliveredPayment.mockResolvedValue({
      asset: { code: "USDC", issuer: ISSUER },
      amount: "9.8765432",
      sourceAsset: { code: "XLM", issuer: null },
      sourceAmount: "100.0000000",
      isPathPayment: true,
      destinationMin: "9.5000000",
    });

    const res = await invoke({
      projectId: "proj-1",
      donorAddress: DONOR,
      amount: "50", // a lie / stale estimate — must be ignored
      currency: "USDC",
      transactionHash: TX,
      pathPayment: true,
    });

    expect(res.statusCode).toBe(201);
    expect(stellar.getDeliveredPayment).toHaveBeenCalledWith({
      transactionHash: TX,
      destination: PROJECT_WALLET,
      source: DONOR,
    });
    const params = insertParams(client);
    expect(params[3]).toBeNull(); // amount_xlm — not an XLM delivery
    expect(params[4]).toBeCloseTo(9.8765432, 7); // amount
    expect(params[5]).toBe("USDC"); // currency
    expect(params[9]).toBe("XLM"); // source_asset
    expect(params[10]).toBe("100.0000000"); // source_amount
  });

  it("rejects a delivery in the wrong asset and writes nothing", async () => {
    const client = mockClient({ preferred: { code: "USDC", issuer: ISSUER } });
    stellar.getDeliveredPayment.mockResolvedValue({
      asset: { code: "XLM", issuer: null },
      amount: "100.0000000",
      sourceAsset: { code: "XLM", issuer: null },
      sourceAmount: "100.0000000",
      isPathPayment: false,
    });

    const res = await invoke({
      projectId: "proj-1", donorAddress: DONOR, amount: "100", currency: "USDC", transactionHash: TX,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("asset_mismatch");
    expect(insertParams(client)).toBeUndefined();
    expect(client.query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
  });

  it("rejects a transaction that pays the project nothing", async () => {
    const client = mockClient({ preferred: { code: "USDC", issuer: ISSUER } });
    stellar.getDeliveredPayment.mockResolvedValue(null);

    const res = await invoke({
      projectId: "proj-1", donorAddress: DONOR, amount: "5", currency: "USDC", transactionHash: TX, pathPayment: true,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("no_delivery");
    expect(insertParams(client)).toBeUndefined();
  });

  it("surfaces a slippage violation from verification as 400", async () => {
    mockClient({ preferred: { code: "USDC", issuer: ISSUER } });
    const { DeliveryVerificationError } = jest.requireActual("../services/pathPayment");
    stellar.getDeliveredPayment.mockRejectedValue(
      new DeliveryVerificationError("Delivered amount is below the signed minimum", "slippage_exceeded"),
    );

    const res = await invoke({
      projectId: "proj-1", donorAddress: DONOR, amount: "5", currency: "USDC", transactionHash: TX, pathPayment: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("slippage_exceeded");
  });

  it("verifies a USDC → XLM path payment to a project without a preferred asset", async () => {
    const client = mockClient();
    stellar.getDeliveredPayment.mockResolvedValue({
      asset: { code: "XLM", issuer: null },
      amount: "48.1234567",
      sourceAsset: { code: "USDC", issuer: ISSUER },
      sourceAmount: "5.0000000",
      isPathPayment: true,
    });

    const res = await invoke({
      projectId: "proj-1", donorAddress: DONOR, amountXLM: "50", currency: "XLM", transactionHash: TX, pathPayment: true,
    });

    expect(res.statusCode).toBe(201);
    const params = insertParams(client);
    expect(params[3]).toBeCloseTo(48.1234567, 7); // amount_xlm
    expect(params[5]).toBe("XLM");
    expect(params[9]).toBe(`USDC:${ISSUER}`);
    expect(params[10]).toBe("5.0000000");
  });

  it("leaves ordinary XLM donations to XLM projects on the existing flow", async () => {
    const client = mockClient();

    const res = await invoke({
      projectId: "proj-1", donorAddress: DONOR, amountXLM: "25", transactionHash: TX,
    });

    expect(res.statusCode).toBe(201);
    expect(stellar.getDeliveredPayment).not.toHaveBeenCalled();
    const params = insertParams(client);
    expect(params[5]).toBe("XLM");
    expect(params[9]).toBeNull();
    expect(params[10]).toBeNull();
  });
});
