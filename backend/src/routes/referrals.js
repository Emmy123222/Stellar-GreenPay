/**
 * src/routes/referrals.js
 * Referral system routes - track referrals and award badge XP bonuses
 */
"use strict";
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const logger = require("../logger");

/**
 * GET /api/referrals/:publicKey
 * Get referral stats for a wallet address
 */
router.get("/:publicKey", async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    
    // Validate public key format
    if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
      const e = new Error("Invalid Stellar public key");
      e.status = 400;
      throw e;
    }

    const result = await pool.query(
      `SELECT 
        referral_count,
        referral_bonus_xlm,
        referred_by
       FROM profiles 
       WHERE public_key = $1`,
      [publicKey]
    );

    if (!result.rows[0]) {
      return res.json({
        success: true,
        data: {
          referralCount: 0,
          referralBonusXLM: "0",
          referredBy: null
        }
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        referralCount: row.referral_count || 0,
        referralBonusXLM: row.referral_bonus_xlm || "0",
        referredBy: row.referred_by
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/referrals
 * Record a referral relationship when a new user signs up
 */
router.post("/", async (req, res, next) => {
  let client;
  try {
    const { referrerAddress, referredAddress } = req.body;

    // Validate public keys
    if (!referrerAddress || !/^G[A-Z0-9]{55}$/.test(referrerAddress)) {
      const e = new Error("Invalid referrer address");
      e.status = 400;
      throw e;
    }
    if (!referredAddress || !/^G[A-Z0-9]{55}$/.test(referredAddress)) {
      const e = new Error("Invalid referred address");
      e.status = 400;
      throw e;
    }
    if (referrerAddress === referredAddress) {
      const e = new Error("Cannot refer yourself");
      e.status = 400;
      throw e;
    }

    client = await pool.connect();

    // Check if referral already exists
    const existingResult = await client.query(
      "SELECT id FROM referrals WHERE referrer_address = $1 AND referred_address = $2",
      [referrerAddress, referredAddress]
    );
    if (existingResult.rows[0]) {
      return res.json({ success: true, data: existingResult.rows[0] });
    }

    // Create referral record
    const result = await client.query(
      `INSERT INTO referrals (referrer_address, referred_address)
       VALUES ($1, $2)
       RETURNING *`,
      [referrerAddress, referredAddress]
    );

    // Update referrer's profile with referred_by if not set
    await client.query(
      `UPDATE profiles 
       SET referred_by = $1 
       WHERE public_key = $2 AND referred_by IS NULL`,
      [referrerAddress, referredAddress]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  } finally {
    if (client) client.release();
  }
});

/**
 * POST /api/referrals/award-bonus
 * Award referral bonus when referred user makes first donation
 * Called internally by donations route
 */
router.post("/award-bonus", async (req, res, next) => {
  let client;
  try {
    const { referredAddress, donationId, amountXLM } = req.body;

    if (!referredAddress || !donationId) {
      const e = new Error("Missing required fields");
      e.status = 400;
      throw e;
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // Find referral record
    const referralResult = await client.query(
      `SELECT id, referrer_address, bonus_awarded 
       FROM referrals 
       WHERE referred_address = $1 AND bonus_awarded = FALSE`,
      [referredAddress]
    );

    if (!referralResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.json({ success: true, data: { awarded: false, reason: "No pending referral" } });
    }

    const referral = referralResult.rows[0];
    const bonusXLM = 5; // Fixed 5 XLM bonus

    // Update referral record
    await client.query(
      `UPDATE referrals 
       SET bonus_awarded = TRUE,
           first_donation_id = $1,
           first_donation_at = NOW(),
           bonus_xlm = $2
       WHERE id = $3`,
      [donationId, bonusXLM, referral.id]
    );

    // Update referrer's profile
    await client.query(
      `UPDATE profiles 
       SET referral_count = referral_count + 1,
           referral_bonus_xlm = referral_bonus_xlm + $1,
           total_donated_xlm = total_donated_xlm + $1
       WHERE public_key = $2`,
      [bonusXLM, referral.referrer_address]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: {
        awarded: true,
        bonusXLM: bonusXLM.toString(),
        referrerAddress: referral.referrer_address
      }
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    next(err);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
