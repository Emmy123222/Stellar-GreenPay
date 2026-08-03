"use strict";

jest.mock("pg-boss", () => {
  const mockBoss = {
    on: jest.fn(),
    start: jest.fn(),
    schedule: jest.fn(),
    work: jest.fn(),
  };
  return function PgBoss() { return mockBoss; };
}, { virtual: true });
jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const pool = require("../db/pool");
const logger = require("../logger");
const { runDigest } = require("./digestQueue");

global.fetch = jest.fn();

describe("runDigest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("no active projects with subscribers sends no emails", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await runDigest();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "digest_run_complete", sent: 0 }),
      expect.any(String),
    );
  });
});
