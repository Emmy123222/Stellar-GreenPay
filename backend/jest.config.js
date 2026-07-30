"use strict";
const path = require("path");
module.exports = {
  testRunner: "jest-circus/runner",
  transformIgnorePatterns: ["/node_modules/(?!uuid)"],
  moduleNameMapper: {
    "^uuid$": require.resolve("uuid"),
  },
};
