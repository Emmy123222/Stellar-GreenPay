"use strict";

module.exports = {
  sha256: function (data) { return new Uint8Array(32); },
  sha512: function (data) { return new Uint8Array(64); },
};
