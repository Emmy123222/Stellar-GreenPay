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
const { getFiatRates, SUPPORTED_FIAT } = require("../services/priceOracle");

async function handlePrice(req, res, next) {
  try {
    const fiatData = await getFiatRates();
    const queryCur = typeof req.query.currency === "string" ? req.query.currency.toUpperCase() : null;
    const currency = (queryCur && SUPPORTED_FIAT.includes(queryCur)) ? queryCur : "USD";
    const rate = fiatData.rates[currency] ?? fiatData.rates.USD;

    res.json({
      success: true,
      data: {
        xlmPerUsdc: fiatData.xlmPerUsdc,
        usdPerXlm: fiatData.rates.USD,
        rates: fiatData.rates,
        rate,
        currency,
        cached: fiatData.cached,
        isStale: fiatData.isStale,
        fallback: fiatData.fallback,
        timestamp: fiatData.timestamp,
      },
    });
  } catch (e) {
    next(e);
  }
}

router.get("/xlm-usdc", handlePrice);
router.get("/rates", handlePrice);
router.get("/", handlePrice);

module.exports = router;
