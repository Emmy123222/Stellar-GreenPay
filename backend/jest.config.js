"use strict";
const path = require("path");
module.exports = {
  testRunner: "jest-circus/runner",
  moduleNameMapper: {
    "^uuid$": "<rootDir>/src/test-mocks/uuid.js"
  },
};
