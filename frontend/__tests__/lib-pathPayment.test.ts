import {
  assetKey,
  bestStrictSendPath,
  clampSlippageBps,
  DEFAULT_SLIPPAGE_BPS,
  fromStroops,
  maxSent,
  MAX_SLIPPAGE_BPS,
  minReceived,
  MIN_SLIPPAGE_BPS,
  quoteWithinBound,
  sameAsset,
  toStroops,
} from "@/lib/pathPayment";

const ISSUER = `G${"I".repeat(55)}`;

describe("stroop conversion", () => {
  it("round-trips and truncates past 7 dp", () => {
    expect(toStroops("1.2345678")).toBe(BigInt(12345678));
    expect(toStroops("1.23456789")).toBe(BigInt(12345678));
    expect(fromStroops(BigInt(5))).toBe("0.0000005");
    expect(() => toStroops("-1")).toThrow();
  });
});

describe("slippage bounds", () => {
  it("minReceived subtracts slippage and rounds down to the stroop", () => {
    expect(minReceived("100.0000000", 100)).toBe("99.0000000");
    expect(minReceived("9.8765432", 50)).toBe("9.8271604"); // 9.8271604.84 → floor
    expect(minReceived("0.0000001", 100)).toBe("0.0000000");
  });

  it("maxSent adds slippage and rounds up to the stroop", () => {
    expect(maxSent("100.0000000", 100)).toBe("101.0000000");
    expect(maxSent("0.0000001", 100)).toBe("0.0000002");
  });

  it("never lets the bound go past the allowed band", () => {
    expect(clampSlippageBps(10_000)).toBe(MAX_SLIPPAGE_BPS);
    expect(clampSlippageBps(0)).toBe(MIN_SLIPPAGE_BPS);
    expect(clampSlippageBps(Number.NaN)).toBe(DEFAULT_SLIPPAGE_BPS);
    // A 90% "slippage" request is clamped to 5%.
    expect(minReceived("100", 9000)).toBe("95.0000000");
  });

  it("quoteWithinBound accepts quotes at or above destMin only", () => {
    expect(quoteWithinBound("99.0000000", "99.0000000")).toBe(true);
    expect(quoteWithinBound("99.5", "99.0000000")).toBe(true);
    expect(quoteWithinBound("98.9999999", "99.0000000")).toBe(false);
  });
});

describe("path selection and assets", () => {
  it("picks the path that delivers the most", () => {
    const best = bestStrictSendPath([
      { source_amount: "100", destination_amount: "9.5", path: [] },
      { source_amount: "100", destination_amount: "9.8765432", path: [] },
      { source_amount: "100", destination_amount: "9.87", path: [] },
    ]);
    expect(best?.destination_amount).toBe("9.8765432");
    expect(bestStrictSendPath([])).toBeNull();
  });

  it("compares assets by code and issuer", () => {
    expect(assetKey({ code: "XLM" })).toBe("XLM");
    expect(sameAsset(null, { code: "XLM" })).toBe(true);
    expect(sameAsset({ code: "USDC", issuer: ISSUER }, { code: "USDC", issuer: `G${"Z".repeat(55)}` })).toBe(false);
  });
});
