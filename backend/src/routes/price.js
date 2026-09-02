/**
 * src/routes/price.js
 *
 * Exposes the live USDC → XLM mid-price from the Stellar DEX.
 *
 * GET /api/price/xlm-usdc
 *   Returns { success: true, data: { xlmPerUsdc: number, cached: boolean } }
 */
"use strict";

const express = require("express");
const router  = express.Router();
const { getUsdcToXlmRate, FALLBACK_XLM_PER_USDC } = require("../services/priceOracle");
const cache = require("../services/cache");

/**
 * GET /api/price/xlm-usdc
 *
 * Returns the current USDC → XLM mid-price sourced from the Stellar DEX
 * Horizon orderbook. The price is cached for 30 seconds.
 */
router.get("/xlm-usdc", async (req, res, next) => {
  try {
    const cached = cache.get("xlm_usdc_mid_price");
    const xlmPerUsdc = await getUsdcToXlmRate();
    res.json({
      success: true,
      data: {
        xlmPerUsdc,
        cached: cached !== null,
        fallback: xlmPerUsdc === FALLBACK_XLM_PER_USDC,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
