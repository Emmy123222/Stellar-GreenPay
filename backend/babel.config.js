"use strict";
// Jest transforms only the ESM-only dependencies whitelisted in
// jest.config.js (transformIgnorePatterns), turning their ESM syntax into
// CommonJS so the test runner can load them.
module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
  ],
};
