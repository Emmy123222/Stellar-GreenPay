"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

let pool;
let logAdminAction;

describe("audit log retention", () => {
  beforeEach(() => {
    jest.resetModules();
    pool = require("../db/pool");
    pool.query.mockResolvedValue({ rows: [] });
    ({ logAdminAction } = require("./audit"));
  });

  test("prunes entries older than 90 days after recording an action", async () => {
    await logAdminAction({ actor: "admin", action: "project.updated" });

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO admin_audit_log"),
      expect.any(Array),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("created_at < NOW() - ($1 * INTERVAL '1 day')"),
      [90],
    );
  });

  test("runs cleanup no more than once per day", async () => {
    await logAdminAction({ actor: "admin", action: "project.updated" });
    await logAdminAction({ actor: "admin", action: "project.updated" });

    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  test("records actions even when retention cleanup fails", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("cleanup failed"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(logAdminAction({ actor: "admin", action: "project.updated" })).resolves.toBeUndefined();

    expect(pool.query).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});