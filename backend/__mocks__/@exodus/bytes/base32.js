"use strict";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CHAR_MAP = Object.create(null);
for (let i = 0; i < ALPHABET.length; i++) {
  CHAR_MAP[ALPHABET[i]] = i;
}

function toBase32(arr, { padding = false } = {}) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < arr.length; i++) {
    value = (value << 8) | arr[i];
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }

  if (padding) {
    while (output.length % 8 !== 0) {
      output += "=";
    }
  }

  return output;
}

function fromBase32(str, { padding = false } = {}) {
  if (typeof str !== "string") {
    throw new TypeError("Expected string");
  }
  const cleanStr = str.replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const c = cleanStr[i].toUpperCase();
    const val = CHAR_MAP[c];
    if (val === undefined) {
      throw new Error("Invalid base32 character: " + cleanStr[i]);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

module.exports = {
  toBase32,
  fromBase32,
  fromBase32hex: () => { throw new Error("not implemented"); },
  fromBase32crockford: () => { throw new Error("not implemented"); },
  toBase32hex: () => { throw new Error("not implemented"); },
  toBase32crockford: () => { throw new Error("not implemented"); },
};
