"use strict";
const path = require("path");
module.exports = {
  testRunner: "jest-circus/runner",
  transformIgnorePatterns: ["/node_modules/(?!uuid)"],
  moduleNameMapper: {
    // uuid v14 is pure ESM; map to a CJS shim so Jest can require() it.
    "^uuid$": path.resolve(__dirname, "__mocks__/uuid.js"),
  },
};
