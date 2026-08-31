"use strict";

const { Keypair } = require("@stellar/stellar-sdk");

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function getWalletAddressFromRequest(req) {
  const header = req.get("X-Wallet-Address");
  if (header && typeof header === "string") {
    return header.trim();
  }
  return null;
}

function verifySignedChallenge(walletAddress, challenge, signatureBase64) {
  if (!walletAddress || !challenge || !signatureBase64) {
    return false;
  }

  try {
    const keypair = Keypair.fromPublicKey(walletAddress);
    const signature = Buffer.from(signatureBase64, "base64");
    return keypair.verify(Buffer.from(challenge, "utf8"), signature);
  } catch {
    return false;
  }
}

/**
 * Returns true when the request proves ownership of projectWalletAddress.
 * Accepts a matching X-Wallet-Address header, or a signed challenge via
 * X-Wallet-Challenge + X-Wallet-Signature (with X-Wallet-Address).
 */
function isProjectOwner(req, projectWalletAddress) {
  const walletAddress = getWalletAddressFromRequest(req);
  if (!walletAddress || !STELLAR_ADDRESS_RE.test(walletAddress)) {
    return false;
  }

  if (walletAddress !== projectWalletAddress) {
    return false;
  }

  const challenge = req.get("X-Wallet-Challenge");
  const signature = req.get("X-Wallet-Signature");

  if (challenge || signature) {
    return verifySignedChallenge(walletAddress, challenge, signature);
  }

  return true;
}

module.exports = {
  STELLAR_ADDRESS_RE,
  getWalletAddressFromRequest,
  verifySignedChallenge,
  isProjectOwner,
};
