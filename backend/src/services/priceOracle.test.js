"use strict";

jest.mock("./stellar", () => ({
  server: { orderbook: jest.fn() },
}));

const cache = require("./cache");
const { server: horizonServer } = require("./stellar");
const { getUsdcToXlmRate, FALLBACK_XLM_PER_USDC } = require("./priceOracle");

const CACHE_KEY = "xlm_usdc_mid_price";

function mockOrderbookCall(call) {
  horizonServer.orderbook.mockReturnValue({
    limit: jest.fn(() => ({ call })),
  });
}

function orderbook(askNumerator, askDenominator, bidNumerator, bidDenominator) {
  return {
    asks: [{ price_r: { n: askNumerator, d: askDenominator } }],
    bids: [{ price_r: { n: bidNumerator, d: bidDenominator } }],
  };
}

const FIAT_CACHE_KEY = "xlm_fiat_rates";

beforeEach(() => {
  cache.del(CACHE_KEY);
  cache.del(FIAT_CACHE_KEY);
  horizonServer.orderbook.mockReset();
  jest.useRealTimers();
});

afterEach(() => {
  cache.del(CACHE_KEY);
  cache.del(FIAT_CACHE_KEY);
  jest.useRealTimers();
});

describe("services/priceOracle", () => {
  test("fetches the XLM/USDC orderbook and parses the rational mid-price", async () => {
    const call = jest.fn().mockResolvedValue(orderbook(17, 2, 16, 2));
    mockOrderbookCall(call);

    await expect(getUsdcToXlmRate()).resolves.toBe(8.25);
    expect(horizonServer.orderbook).toHaveBeenCalledWith(
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: expect.any(String),
      },
      { asset_type: "native" },
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("reuses a fresh cached quote without another Horizon request", async () => {
    const call = jest.fn().mockResolvedValue(orderbook(9, 1, 7, 1));
    mockOrderbookCall(call);

    await expect(getUsdcToXlmRate()).resolves.toBe(8);
    await expect(getUsdcToXlmRate()).resolves.toBe(8);
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("falls back after a provider HTTP error and retries instead of caching the failure", async () => {
    const call = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Horizon unavailable"), { response: { status: 503 } }))
      .mockResolvedValueOnce(orderbook(10, 1, 8, 1));
    mockOrderbookCall(call);

    await expect(getUsdcToXlmRate()).resolves.toBe(FALLBACK_XLM_PER_USDC);
    await expect(getUsdcToXlmRate()).resolves.toBe(9);
    expect(call).toHaveBeenCalledTimes(2);
  });

  test("treats an expired quote as stale and fetches a fresh mid-price", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const call = jest
      .fn()
      .mockResolvedValueOnce(orderbook(10, 1, 8, 1))
      .mockResolvedValueOnce(orderbook(12, 1, 10, 1));
    mockOrderbookCall(call);

    await expect(getUsdcToXlmRate()).resolves.toBe(9);
    jest.advanceTimersByTime(30_001);
    await expect(getUsdcToXlmRate()).resolves.toBe(11);
    expect(call).toHaveBeenCalledTimes(2);
  });

  test("uses and caches the fallback when either side of the book is empty", async () => {
    const call = jest.fn().mockResolvedValue({ asks: [], bids: [{ price_r: { n: 8, d: 1 } }] });
    mockOrderbookCall(call);

    await expect(getUsdcToXlmRate()).resolves.toBe(FALLBACK_XLM_PER_USDC);
    await expect(getUsdcToXlmRate()).resolves.toBe(FALLBACK_XLM_PER_USDC);
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("getFiatRates returns exchange rates for USD, EUR, and BRL", async () => {
    const { getFiatRates } = require("./priceOracle");
    const call = jest.fn().mockResolvedValue(orderbook(8, 1, 8, 1));
    mockOrderbookCall(call);

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("Network offline"));

    try {
      const fiat = await getFiatRates();
      expect(fiat).toHaveProperty("rates");
      expect(fiat.rates).toHaveProperty("USD");
      expect(fiat.rates).toHaveProperty("EUR");
      expect(fiat.rates).toHaveProperty("BRL");
      expect(fiat.rates.USD).toBeCloseTo(0.125, 4);
      expect(fiat.rates.EUR).toBeCloseTo(0.125 * 0.92, 4);
      expect(fiat.rates.BRL).toBeCloseTo(0.125 * 5.5, 4);
      expect(fiat.cached).toBe(false);

      // Subsequent call should be cached
      const cachedFiat = await getFiatRates();
      expect(cachedFiat.cached).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("getFiatRates uses external CoinGecko rates when available", async () => {
    cache.del(FIAT_CACHE_KEY);
    const { getFiatRates } = require("./priceOracle");
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.15, eur: 0.138, brl: 0.825 },
      }),
    });

    try {
      const fiat = await getFiatRates();
      expect(fiat.rates.USD).toBe(0.15);
      expect(fiat.rates.EUR).toBe(0.138);
      expect(fiat.rates.BRL).toBe(0.825);
      expect(fiat.fallback).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
