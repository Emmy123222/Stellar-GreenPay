"use strict";

const migration = require("./migrations/008_create_dead_letter");

describe("008_create_dead_letter migration", () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rowCount: 0 }),
    };
  });

  test("up executes table and index creations", async () => {
    await migration.up(mockClient);

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS dead_letter")
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_dead_letter_queue_name")
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_dead_letter_failed_at")
    );
  });

  test("down drops dead_letter table", async () => {
    await migration.down(mockClient);

    expect(mockClient.query).toHaveBeenCalledWith(
      "DROP TABLE IF EXISTS dead_letter"
    );
  });
});
