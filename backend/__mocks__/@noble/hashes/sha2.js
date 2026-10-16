"use strict";
const crypto = require("crypto");

function toBuffer(msg) {
  if (Buffer.isBuffer(msg)) return msg;
  if (msg instanceof Uint8Array) {
    return Buffer.from(msg.buffer, msg.byteOffset, msg.byteLength);
  }
  return Buffer.from(msg);
}

function sha256(msg) {
  return new Uint8Array(crypto.createHash("sha256").update(toBuffer(msg)).digest());
}

function sha512(msg) {
  return new Uint8Array(crypto.createHash("sha512").update(toBuffer(msg)).digest());
}

function sha224(msg) {
  return new Uint8Array(crypto.createHash("sha224").update(toBuffer(msg)).digest());
}

function sha384(msg) {
  return new Uint8Array(crypto.createHash("sha384").update(toBuffer(msg)).digest());
}

module.exports = {
  sha256,
  sha512,
  sha224,
  sha384,
};
