"use strict";
/**
 * Unit tests for src/services/pathPayment.js (#1660): delivered-amount
 * extraction from Horizon operation records, asset checks and slippage guard.
 */

const {
  toStroops,
  fromStroops,
  assetId,
  validatePreferredAsset,
  extractDelivery,
  assertDeliveryMatchesProject,
  DeliveryVerificationError,
} = require("./pathPayment");

const DONOR = `G${"D".repeat(55)}`;
const PROJECT = `G${"P".repeat(55)}`;
const ISSUER = `G${"I".repeat(55)}`;
const USDC = { code: "USDC", issuer: ISSUER };

/** Horizon record for a strict-send XLM → USDC path payment. */
function strictSend(overrides = {}) {
  return {
    type: "path_payment_strict_send",
    transaction_successful: true,
    source_account: DONOR,
    from: DONOR,
    to: PROJECT,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    amount: "9.8765432", // actually delivered
    destination_min: "9.5000000",
    source_asset_type: "native",
    source_amount: "100.0000000",
    ...overrides,
  };
}

describe("stroop arithmetic", () => {
  it("round-trips 7-decimal amounts exactly", () => {
    expect(toStroops("1.2345678")).toBe(12345678n);
    expect(toStroops("100")).toBe(1000000000n);
    expect(fromStroops(12345678n)).toBe("1.2345678");
    expect(fromStroops(toStroops("0.1") + toStroops("0.2"))).toBe("0.3000000");
  });

  it("rejects malformed amounts", () => {
    expect(() => toStroops("1.12345678")).toThrow(DeliveryVerificationError);
    expect(() => toStroops("-1")).toThrow(DeliveryVerificationError);
    expect(() => toStroops("abc")).toThrow(DeliveryVerificationError);
  });
});

describe("validatePreferredAsset", () => {
  it("treats null / XLM as native", () => {
    expect(validatePreferredAsset(null)).toBeNull();
    expect(validatePreferredAsset({ code: null })).toBeNull();
    expect(validatePreferredAsset({ code: "XLM" })).toBeNull();
  });

  it("accepts a credit asset", () => {
    expect(validatePreferredAsset({ code: " USDC ", issuer: ISSUER })).toEqual(USDC);
  });

  it("rejects bad codes and issuers", () => {
    expect(() => validatePreferredAsset({ code: "TOO-LONG-CODE!", issuer: ISSUER })).toThrow(/code/);
    expect(() => validatePreferredAsset({ code: "USDC", issuer: "nope" })).toThrow(/issuer/);
    expect(() => validatePreferredAsset({ code: "USDC" })).toThrow(/issuer/);
  });
});

describe("extractDelivery", () => {
  it("uses the delivered amount, not the sent amount or destMin", () => {
    const d = extractDelivery([strictSend()], { destination: PROJECT, source: DONOR });
    expect(d).toEqual({
      asset: USDC,
      amount: "9.8765432",
      sourceAsset: { code: "XLM", issuer: null },
      sourceAmount: "100.0000000",
      isPathPayment: true,
      destinationMin: "9.5000000",
    });
  });

  it("handles strict-receive path payments", () => {
    const d = extractDelivery(
      [strictSend({ type: "path_payment_strict_receive", amount: "10.0000000", destination_min: undefined, source_max: "105.0000000", source_amount: "101.2000000" })],
      { destination: PROJECT, source: DONOR },
    );
    expect(d.amount).toBe("10.0000000");
    expect(d.sourceAmount).toBe("101.2000000");
    expect(d.destinationMin).toBeNull();
  });

  it("handles a plain native payment", () => {
    const d = extractDelivery(
      [{ type: "payment", to: PROJECT, from: DONOR, asset_type: "native", amount: "25.0000000" }],
      { destination: PROJECT, source: DONOR },
    );
    expect(d).toMatchObject({ asset: { code: "XLM", issuer: null }, amount: "25.0000000", isPathPayment: false });
  });

  it("ignores operations to other accounts or from other sources", () => {
    const records = [
      strictSend({ to: `G${"X".repeat(55)}` }),
      strictSend({ from: `G${"Y".repeat(55)}`, source_account: `G${"Y".repeat(55)}` }),
      { type: "change_trust" },
    ];
    expect(extractDelivery(records, { destination: PROJECT, source: DONOR })).toBeNull();
  });

  it("sums several deliveries of the same asset", () => {
    const d = extractDelivery(
      [strictSend({ amount: "1.5000000", destination_min: "1.0000000" }), strictSend({ amount: "2.2500000", destination_min: "2.0000000" })],
      { destination: PROJECT, source: DONOR },
    );
    expect(d.amount).toBe("3.7500000");
    expect(d.sourceAmount).toBe("200.0000000");
    expect(d.destinationMin).toBe("3.0000000");
  });

  it("rejects transactions that deliver two different assets", () => {
    expect(() =>
      extractDelivery(
        [strictSend(), { type: "payment", to: PROJECT, from: DONOR, asset_type: "native", amount: "1.0000000" }],
        { destination: PROJECT, source: DONOR },
      ),
    ).toThrow(/more than one asset/);
  });

  it("enforces the slippage bound: delivered below destMin is rejected", () => {
    expect(() =>
      extractDelivery([strictSend({ amount: "9.4999999", destination_min: "9.5000000" })], {
        destination: PROJECT,
        source: DONOR,
      }),
    ).toThrow(expect.objectContaining({ code: "slippage_exceeded" }));
  });

  it("accepts delivery exactly at destMin", () => {
    const d = extractDelivery([strictSend({ amount: "9.5000000" })], { destination: PROJECT, source: DONOR });
    expect(d.amount).toBe("9.5000000");
  });
});

describe("assertDeliveryMatchesProject", () => {
  const delivered = { asset: USDC, amount: "9.8765432" };

  it("passes when the asset matches the preferred asset", () => {
    expect(assertDeliveryMatchesProject(delivered, USDC)).toBe(delivered);
  });

  it("expects XLM when the project has no preferred asset", () => {
    expect(() => assertDeliveryMatchesProject(delivered, null)).toThrow(
      expect.objectContaining({ code: "asset_mismatch", status: 400 }),
    );
  });

  it("rejects a same-code asset from a different issuer", () => {
    expect(() => assertDeliveryMatchesProject(delivered, { code: "USDC", issuer: `G${"Z".repeat(55)}` })).toThrow(
      /expects USDC:GZ/,
    );
  });

  it("rejects a missing delivery", () => {
    expect(() => assertDeliveryMatchesProject(null, USDC)).toThrow(expect.objectContaining({ code: "no_delivery" }));
  });

  it("formats asset ids", () => {
    expect(assetId(null)).toBe("XLM");
    expect(assetId(USDC)).toBe(`USDC:${ISSUER}`);
  });
});
