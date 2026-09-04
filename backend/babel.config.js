"use strict";
// Babel config for Jest. The backend source is plain CommonJS, but several
// runtime dependencies are pure ESM (file-type, express-rate-limit, axios,
// …). Jest's babel-jest transformer uses this config to compile those
// node_modules packages to CJS at test time (see transformIgnorePatterns in
// jest.config.js — everything in node_modules except the shimmed uuid is
// transformed).
module.exports = {
  presets: [
    [
      "@babel/preset-env",
      {
        targets: { node: "20" },
        modules: "commonjs",
      },
    ],
  ],
};
