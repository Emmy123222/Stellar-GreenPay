/**
 * src/services/priceOracle.js
 *
 * USDC → XLM price oracle backed by the Stellar DEX Horizon orderbook.
 *
 * Fetches the live mid-price (average of best ask and best bid) for the
 * XLM / USDC pair and caches the result for 30 seconds to avoid hammering
 * Horizon on every donation call.
 *
 * The mid-price is defined as:
 *   mid = (best_ask + best_bid) / 2
 * where each side price = price_n / price_d from Horizon's orderbook record.
 *
 * Falls back to 8 XLM per USDC if Horizon is unreachable or the orderbook
 * has no offers on either side.
 */
"use strict";

const cache = require("./cache");
const { server: horizonServer } = require("./stellar");

const CACHE_KEY    = "xlm_usdc_mid_price";
const CACHE_TTL_MS = 30_000; // 30 seconds
const FALLBACK_XLM_PER_USDC = 8;

/**
 * Compute the mid-price from a Horizon orderbook response.
 *
 * @param {{ asks: Array<{price_r: {n: number, d: number}}>, bids: Array<{price_r: {n: number, d: number}}> }} book
 * @returns {number|null} XLM per USDC mid-price, or null if either side is empty.
 */
function midPriceFromBook(book) {
  if (!book.asks?.length || !book.bids?.length) return null;

  const ask = book.asks[0];
  const bid = book.bids[0];

  // Horizon orderbook prices for XLM/USDC:
  //   ask.price = XLM you pay per USDC (selling USDC to get XLM)
  //   bid.price = XLM you receive per USDC (buying USDC with XLM)
  const askPrice = ask.price_r.n / ask.price_r.d;
  const bidPrice = bid.price_r.n / bid.price_r.d;

  if (!isFinite(askPrice) || !isFinite(bidPrice) || askPrice <= 0 || bidPrice <= 0) {
    return null;
  }

  return (askPrice + bidPrice) / 2;
}

/**
 * Fetch the USDC → XLM mid-price from the Stellar DEX via Horizon.
 *
 * Results are cached for 30 seconds. Returns the fallback rate on any error.
 *
 * @returns {Promise<number>} XLM per USDC (e.g. 8.5 means 1 USDC ≈ 8.5 XLM).
 */
async function getUsdcToXlmRate() {
  const cached = cache.get(CACHE_KEY);
  if (cached !== null) return cached;

  try {
    // Horizon orderbook: selling = USDC, buying = XLM (native)
    const book = await horizonServer
      .orderbook(
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: process.env.USDC_ISSUER || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
        { asset_type: "native" },
      )
      .limit(1)
      .call();

    const price = midPriceFromBook(book);
    if (price === null) {
      return cache.set(CACHE_KEY, FALLBACK_XLM_PER_USDC, CACHE_TTL_MS);
    }

    return cache.set(CACHE_KEY, price, CACHE_TTL_MS);
  } catch {
    // Horizon unreachable — return fallback without caching so next call retries
    return FALLBACK_XLM_PER_USDC;
  }
}

module.exports = { getUsdcToXlmRate, FALLBACK_XLM_PER_USDC };
