/**
 * src/routes/auth.js — Wallet-signature authentication.
 *
 * Donors authenticate by proving control of their Stellar wallet, following
 * the wallet-as-identity model (ADR-003):
 *
 *   1. POST /api/auth/challenge { walletAddress } → { challenge, expiresAt }
 *   2. Client builds a transaction whose text memo is exactly the challenge
 *      and signs it with Freighter (signTransaction).
 *   3. POST /api/auth/token { walletAddress, signedXdr } → { token }
 *
 * The backend verifies the memo matches an unconsumed, unexpired challenge
 * for that wallet and that the transaction carries a valid Ed25519
 * signature from the wallet's public key. Only then is a short-lived JWT
 * issued. The challenge nonce is single-use, so a captured signed
 * transaction cannot be replayed.
 */
"use strict";
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { Transaction, Keypair, Networks } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");
const { signToken } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

// Challenges are short-lived and single-use.
const CHALLENGE_TTL_MINUTES = 5;
// The signed transaction's memo must fit Stellar's 28-byte text memo limit.
const CHALLENGE_BYTES = 12; // → 16 base64url characters

// Wallet auth endpoints are unauthenticated by design, so they get their own
// tighter limiter to slow down challenge-enumeration and token-guessing.
const authLimiter = createRateLimiter(20, 15, "wallet-auth");

function getNetworkPassphrase() {
  return process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

function isValidWalletAddress(address) {
  return typeof address === "string" && STELLAR_ADDRESS_RE.test(address);
}

/**
 * Verify that `signedXdr` is a transaction whose memo is exactly `nonce` and
 * which carries at least one valid signature from `walletAddress`.
 *
 * @returns {boolean}
 */
function verifySignedChallenge(signedXdr, walletAddress, nonce) {
  if (!signedXdr || typeof signedXdr !== "string") return false;

  let tx;
  try {
    tx = new Transaction(signedXdr, getNetworkPassphrase());
  } catch {
    return false;
  }

  // The memo binds this signature to the issued challenge. Depending on the
  // SDK version, MemoText.value is a string or a Buffer — normalise it.
  if (!tx.memo || tx.memo.type !== "text") {
    return false;
  }
  const memoValue = Buffer.isBuffer(tx.memo.value)
    ? tx.memo.value.toString("utf8")
    : tx.memo.value;
  if (memoValue !== nonce) {
    return false;
  }

  try {
    const keypair = Keypair.fromPublicKey(walletAddress);
    const hash = tx.hash();
    return tx.signatures.some((sig) => {
      try {
        return keypair.verify(hash, sig.signature());
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * POST /api/auth/challenge
 * Issue a one-time authentication challenge for a wallet address.
 */
router.post("/challenge", authLimiter, async (req, res, next) => {
  try {
    const { walletAddress } = req.body || {};
    if (!isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ error: "A valid Stellar wallet address is required" });
    }

    const nonce = crypto.randomBytes(CHALLENGE_BYTES).toString("base64url");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000);

    await pool.query(
      `INSERT INTO wallet_auth_challenges (nonce, wallet_address, expires_at)
       VALUES ($1, $2, $3)`,
      [nonce, walletAddress, expiresAt],
    );

    res.json({ success: true, data: { challenge: nonce, expiresAt: expiresAt.toISOString() } });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/auth/token
 * Verify a signed challenge and issue a wallet-authentication JWT.
 */
router.post("/token", authLimiter, async (req, res, next) => {
  try {
    const { walletAddress, signedXdr } = req.body || {};
    if (!isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ error: "A valid Stellar wallet address is required" });
    }
    if (!signedXdr || typeof signedXdr !== "string") {
      return res.status(400).json({ error: "signedXdr is required" });
    }

    // Recover the challenge nonce from the transaction memo.
    let nonce = null;
    try {
      const tx = new Transaction(signedXdr, getNetworkPassphrase());
      if (tx.memo && tx.memo.type === "text") {
        nonce = Buffer.isBuffer(tx.memo.value)
          ? tx.memo.value.toString("utf8")
          : tx.memo.value;
      }
    } catch {
      return res.status(400).json({ error: "Invalid signed transaction" });
    }
    if (!nonce) {
      return res.status(400).json({ error: "Signed transaction must carry the challenge memo" });
    }

    const challengeResult = await pool.query(
      `SELECT nonce, wallet_address, expires_at, consumed_at
       FROM wallet_auth_challenges
       WHERE nonce = $1`,
      [nonce],
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || challenge.wallet_address !== walletAddress) {
      return res.status(401).json({ error: "Unknown challenge" });
    }
    if (challenge.consumed_at) {
      return res.status(401).json({ error: "Challenge already used" });
    }
    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ error: "Challenge expired" });
    }

    if (!verifySignedChallenge(signedXdr, walletAddress, nonce)) {
      return res.status(401).json({ error: "Invalid wallet signature" });
    }

    // Single-use: consume the challenge so the signed transaction can never
    // be replayed, even within its TTL.
    await pool.query(
      "UPDATE wallet_auth_challenges SET consumed_at = NOW() WHERE nonce = $1",
      [nonce],
    );

    const token = signToken({ sub: walletAddress, type: "wallet" }, "1h");
    res.json({
      success: true,
      data: { token, tokenType: "Bearer", expiresIn: 3600 },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
