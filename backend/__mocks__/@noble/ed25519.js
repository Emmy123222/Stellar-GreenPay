"use strict";
const crypto = require("crypto");

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(data);
}

function getPublicKey(secretKey) {
  const seed = toBuffer(secretKey).subarray(0, 32);
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = crypto.createPublicKey(privKey).export({ format: "der", type: "spki" });
  return new Uint8Array(spki.subarray(12));
}

function sign(data, rawSecret) {
  const seed = toBuffer(rawSecret).subarray(0, 32);
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return new Uint8Array(crypto.sign(null, toBuffer(data), privKey));
}

function verify(signature, data, rawPublicKey) {
  try {
    const rawPub = toBuffer(rawPublicKey).subarray(0, 32);
    const pubKey = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, rawPub]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, toBuffer(data), pubKey, toBuffer(signature));
  } catch {
    return false;
  }
}

module.exports = {
  hashes: {
    sha512: (msg) => {
      return new Uint8Array(crypto.createHash("sha512").update(toBuffer(msg)).digest());
    },
  },
  utils: {
    randomSecretKey: () => new Uint8Array(crypto.randomBytes(32)),
    randomPrivateKey: () => new Uint8Array(crypto.randomBytes(32)),
  },
  getPublicKey,
  getPublicKeyAsync: async (s) => getPublicKey(s),
  sign,
  signAsync: async (d, s) => sign(d, s),
  verify,
  verifyAsync: async (s, d, p) => verify(s, d, p),
};
