"use strict";
const path = require("path");
module.exports = {
  testRunner: "jest-circus/runner",
  // Allow Jest to transform uuid (pure ESM in v14+) while keeping node_modules
  // otherwise opaque. All other ESM packages that need CJS shims are handled
  // via moduleNameMapper below.
  transformIgnorePatterns: ["/node_modules/(?!uuid)"],
  moduleNameMapper: {
    // uuid v14 is pure ESM; map to a CJS shim so Jest can require() it.
    "^uuid$": path.resolve(__dirname, "__mocks__/uuid.js"),
    // expo-server-sdk v6+ is pure ESM; same treatment.
    "^expo-server-sdk$": path.resolve(__dirname, "__mocks__/expo-server-sdk.js"),
    // uint8array-extras is pure ESM; map to CJS shim for Jest.
    "^uint8array-extras$": path.resolve(__dirname, "__mocks__/uint8array-extras.js"),
  },
};
