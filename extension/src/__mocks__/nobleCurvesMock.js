"use strict";

module.exports = {
  ed25519: {
    getPublicKey: function () { return new Uint8Array(32); },
    sign: function () { return new Uint8Array(64); },
    verify: function () { return true; },
  },
};
