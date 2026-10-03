"use strict";

module.exports = {
  getPublicKey: function () { return new Uint8Array(32); },
  sign: function () { return new Uint8Array(64); },
  verify: function () { return true; },
  etc: {},
  hashes: {},
  utils: {
    randomBytes: function () { return new Uint8Array(32); },
  }
};
