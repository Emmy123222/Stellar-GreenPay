"use strict";

/**
 * Registers connection and room event handlers on a Socket.IO server instance.
 *
 * Supported client events:
 * - join_project(projectId, callback?): Joins room `project:${projectId}`
 * - leave_project(projectId, callback?): Leaves room `project:${projectId}`
 * - join_global_feed(callback?): Joins room `all-donations`
 * - leave_global_feed(callback?): Leaves room `all-donations`
 *
 * @param {import("socket.io").Server} io
 */
function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("join_project", (projectId, callback) => {
      if (typeof projectId === "string" && projectId.length > 0 && projectId.length <= 128) {
        socket.join(`project:${projectId}`);
      }
      if (typeof callback === "function") callback();
    });

    socket.on("leave_project", (projectId, callback) => {
      if (typeof projectId === "string" && projectId.length > 0) {
        socket.leave(`project:${projectId}`);
      }
      if (typeof callback === "function") callback();
    });

    socket.on("join_global_feed", (callback) => {
      socket.join("all-donations");
      if (typeof callback === "function") callback();
    });

    socket.on("leave_global_feed", (callback) => {
      socket.leave("all-donations");
      if (typeof callback === "function") callback();
    });
  });
}

module.exports = { registerSocketHandlers };
