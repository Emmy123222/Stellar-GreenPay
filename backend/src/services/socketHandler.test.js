"use strict";

const { registerSocketHandlers } = require("./socketHandler");

describe("registerSocketHandlers", () => {
  let connectionHandler;
  let handlers;
  let io;
  let socket;

  beforeEach(() => {
    handlers = new Map();
    io = {
      on: jest.fn((event, handler) => {
        if (event === "connection") connectionHandler = handler;
      }),
    };
    socket = {
      on: jest.fn((event, handler) => handlers.set(event, handler)),
      join: jest.fn(),
      leave: jest.fn(),
    };

    registerSocketHandlers(io);
    connectionHandler(socket);
  });

  test("registers the connection and feed event handlers", () => {
    expect(io.on).toHaveBeenCalledWith("connection", expect.any(Function));
    expect([...handlers.keys()]).toEqual([
      "join_project",
      "leave_project",
      "join_global_feed",
      "leave_global_feed",
      "disconnect",
    ]);
  });

  test("joins and leaves the requested project feed", () => {
    const joinAck = jest.fn();
    const leaveAck = jest.fn();

    handlers.get("join_project")("project-123", joinAck);
    handlers.get("leave_project")("project-123", leaveAck);

    expect(socket.join).toHaveBeenCalledWith("project:project-123");
    expect(socket.leave).toHaveBeenCalledWith("project:project-123");
    expect(joinAck).toHaveBeenCalledTimes(1);
    expect(leaveAck).toHaveBeenCalledTimes(1);
  });

  test.each([null, undefined, "", 123, {}, [], "p".repeat(129)])(
    "ignores malformed project IDs (%p) without throwing",
    (projectId) => {
      const joinAck = jest.fn();
      const leaveAck = jest.fn();

      expect(() => {
        handlers.get("join_project")(projectId, joinAck);
        handlers.get("leave_project")(projectId, leaveAck);
      }).not.toThrow();

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.leave).not.toHaveBeenCalled();
      expect(joinAck).toHaveBeenCalledTimes(1);
      expect(leaveAck).toHaveBeenCalledTimes(1);
    }
  );
});
