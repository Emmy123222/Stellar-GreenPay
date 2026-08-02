"use strict";
// CJS shim for uuid so Jest (CommonJS transform) can load it.
// Uses Node's built-in crypto.randomUUID which is available in Node >= 14.17.
const { randomUUID } = require("crypto");

function v4() {
  return randomUUID();
}

module.exports = { v4 };
