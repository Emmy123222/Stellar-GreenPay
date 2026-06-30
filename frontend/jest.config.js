const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Path to the Next.js app so next/jest can load next.config and .env files
  dir: "./",
});

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // Mirror the "@/*" path alias from tsconfig.json
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Only run unit/snapshot tests here; Playwright e2e lives in /e2e
  testMatch: ["<rootDir>/**/__tests__/**/*.test.{ts,tsx}"],
};

module.exports = createJestConfig(customJestConfig);
