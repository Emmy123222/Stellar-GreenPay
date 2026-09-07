"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

describe("processTickets", () => {
  let processTickets;
  let mockExpo;
  let pool;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    mockExpo = {
      isExpoPushToken: jest.fn(() => true),
      chunkPushNotifications: jest.fn((msgs) => [msgs]),
      sendPushNotificationsAsync: jest.fn(),
      getPushNotificationReceiptsAsync: jest.fn(),
      chunkPushNotificationReceipts: jest.fn((ids) => [ids]),
    };

    jest.doMock("expo-server-sdk", () => ({
      Expo: jest.fn(() => mockExpo),
      isExpoPushToken: mockExpo.isExpoPushToken,
    }));
    jest.doMock("../db/pool", () => ({ query: jest.fn() }));
    jest.doMock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

    pool = require("../db/pool");
    logger = require("../logger");
    const push = require("./push");
    processTickets = push.processTickets;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function advanceReceiptTimers() {
    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(3000);
    }
  }

  test("deletes token on DeviceNotRegistered ticket error", async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });

    await processTickets(
      [{ id: "ticket-1", status: "error", message: "DeviceNotRegistered" }],
      ["ExpoPushToken[abc]"]
    );

    expect(pool.query).toHaveBeenCalledWith(
      "DELETE FROM device_tokens WHERE token = $1",
      ["ExpoPushToken[abc]"]
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "push_token_removed" }),
      expect.any(String)
    );
  });

  test("updates last_delivered_at on OK receipt", async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });
    mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
    });

    const promise = processTickets(
      [{ id: "ticket-1", status: "ok" }],
      ["ExpoPushToken[abc]"]
    );
    await advanceReceiptTimers();
    await promise;

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE device_tokens SET last_delivered_at"),
      ["ExpoPushToken[abc]"]
    );
  });

  test("does not delete token on transient error (MessageTooBig)", async () => {
    mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "error", message: "MessageTooBig" },
    });

    const promise = processTickets(
      [{ id: "ticket-1", status: "ok" }],
      ["ExpoPushToken[abc]"]
    );
    await advanceReceiptTimers();
    await promise;

    const deleteCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("DELETE")
    );
    expect(deleteCalls).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "push_receipt_error" }),
      expect.any(String)
    );
  });

  test("mixed outcomes: one OK, one DeviceNotRegistered, one transient", async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });
    mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-ok": { status: "ok" },
      "ticket-fail": { status: "error", message: "DeviceNotRegistered" },
      "ticket-warn": { status: "error", message: "MessageTooBig" },
    });

    const promise = processTickets(
      [
        { id: "ticket-ok", status: "ok" },
        { id: "ticket-fail", status: "ok" },
        { id: "ticket-warn", status: "ok" },
      ],
      ["ExpoPushToken[ok]", "ExpoPushToken[fail]", "ExpoPushToken[warn]"]
    );
    await advanceReceiptTimers();
    await promise;

    const deleteCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("DELETE")
    );
    const updateCalls = pool.query.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("UPDATE")
    );

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][1]).toEqual(["ExpoPushToken[fail]"]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual(["ExpoPushToken[ok]"]);
  });

  test("deletes token on DeviceNotRegistered receipt (not just ticket)", async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });
    mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "error", message: "DeviceNotRegistered" },
    });

    const promise = processTickets(
      [{ id: "ticket-1", status: "ok" }],
      ["ExpoPushToken[abc]"]
    );
    await advanceReceiptTimers();
    await promise;

    expect(pool.query).toHaveBeenCalledWith(
      "DELETE FROM device_tokens WHERE token = $1",
      ["ExpoPushToken[abc]"]
    );
  });

  test("does nothing when tickets array is empty", async () => {
    await processTickets([], []);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("does nothing when tickets is undefined", async () => {
    await processTickets(undefined, []);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
