"use strict";

const express = require("express");
const request = require("supertest");

jest.mock("../services/priceOracle", () => ({
  getUsdcToXlmRate: jest.fn(),
  getFiatRates: jest.fn(),
  FALLBACK_XLM_PER_USDC: 8,
  SUPPORTED_FIAT: ["USD", "EUR", "BRL"],
}));

const { getFiatRates, FALLBACK_XLM_PER_USDC } = require("../services/priceOracle");
const priceRouter = require("./price");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/price", priceRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

describe("Price router unit tests", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("returns multi-fiat rates on GET /api/price/xlm-usdc", async () => {
    getFiatRates.mockResolvedValue({
      xlmPerUsdc: 8.5,
      rates: { USD: 0.117647, EUR: 0.108235, BRL: 0.647059 },
      timestamp: Date.now(),
      cached: true,
      isStale: false,
      fallback: false,
    });

    const res = await request(app).get("/api/price/xlm-usdc").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.xlmPerUsdc).toBe(8.5);
    expect(res.body.data.usdPerXlm).toBeCloseTo(0.117647, 4);
    expect(res.body.data.rates.USD).toBe(0.117647);
    expect(res.body.data.rates.EUR).toBe(0.108235);
    expect(res.body.data.rates.BRL).toBe(0.647059);
    expect(res.body.data.cached).toBe(true);
    expect(res.body.data.fallback).toBe(false);
  });

  it("filters/sets selected currency on GET /api/price?currency=EUR", async () => {
    getFiatRates.mockResolvedValue({
      xlmPerUsdc: 8.0,
      rates: { USD: 0.125, EUR: 0.115, BRL: 0.6875 },
      timestamp: Date.now(),
      cached: false,
      isStale: false,
      fallback: false,
    });

    const res = await request(app).get("/api/price?currency=EUR").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.currency).toBe("EUR");
    expect(res.body.data.rate).toBe(0.115);
  });

  it("indicates fallback when rates are generated from fallback", async () => {
    getFiatRates.mockResolvedValue({
      xlmPerUsdc: FALLBACK_XLM_PER_USDC,
      rates: { USD: 0.125, EUR: 0.115, BRL: 0.6875 },
      timestamp: Date.now(),
      cached: false,
      isStale: false,
      fallback: true,
    });

    const res = await request(app).get("/api/price/rates").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.fallback).toBe(true);
  });

  it("handles staleness when reporting cached rates", async () => {
    getFiatRates.mockResolvedValue({
      xlmPerUsdc: 8.0,
      rates: { USD: 0.125, EUR: 0.115, BRL: 0.6875 },
      timestamp: Date.now() - 400_000,
      cached: true,
      isStale: true,
      fallback: false,
    });

    const res = await request(app).get("/api/price").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isStale).toBe(true);
  });

  it("forwards error to error middleware when oracle fails", async () => {
    getFiatRates.mockRejectedValue(new Error("Oracle failure"));

    const res = await request(app).get("/api/price").expect(500);

    expect(res.body.error).toBe("Oracle failure");
  });
});
