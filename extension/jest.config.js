/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__mocks__/styleMock.js',
    '^uint8array-extras$': '<rootDir>/src/__mocks__/uint8arrayExtrasMock.js',
    '^@exodus/bytes(.*)$': '<rootDir>/src/__mocks__/bytesMock.js',
    '^@noble/hashes(.*)$': '<rootDir>/src/__mocks__/nobleHashesMock.js',
    '^@noble/curves(.*)$': '<rootDir>/src/__mocks__/nobleCurvesMock.js',
    '^@noble/ed25519(.*)$': '<rootDir>/src/__mocks__/nobleEd25519Mock.js',
  },
};
