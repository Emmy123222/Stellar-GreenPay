"use strict";
// CJS shim for pg-boss, which ships as a pure-ESM package (v12+).
// Jest's CommonJS runtime cannot parse `import` statements inside
// node_modules, so test files that pull in the queue services map pg-boss
// to this manual mock via `jest.mock("pg-boss")`.
//
// Tests that need to assert on queue behaviour override the constructor with
// `PgBoss.mockImplementation(() => bossInstance)`; the defaults below just
// keep the queue services requireable and inert.

function createDefaultInstance() {
  return {
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue("pgboss-job-1"),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
}

const PgBoss = jest.fn().mockImplementation(createDefaultInstance);

module.exports = PgBoss;
module.exports.default = PgBoss;
