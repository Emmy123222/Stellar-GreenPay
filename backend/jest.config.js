"use strict";
const path = require("path");
module.exports = {
  testRunner: "jest-circus/runner",
  // file-type v18 and its dependency chain (strtok3, token-types,
  // peek-readable, @tokenizer/*) are pure ESM and are required by the uploads
  // route. babel-jest (default transform) compiles them to CJS via
  // babel.config.js; everything else in node_modules is left untouched.
  transformIgnorePatterns: [
    "/node_modules/(?!file-type|strtok3|token-types|peek-readable|@tokenizer)",
  ],
  moduleNameMapper: {
    // uuid v14 is pure ESM; map to a CJS shim so Jest can require() it.
    "^uuid$": path.resolve(__dirname, "__mocks__/uuid.js"),
  },
};
