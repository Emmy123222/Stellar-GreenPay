"use strict";

// Manual mock for expo-server-sdk (pure ESM, uses import.meta so babel-jest
// cannot transform it). Placed in the root __mocks__ directory so Jest applies
// it automatically for node_modules modules. Mirrors the API surface used by
// src/services/push.js: static isExpoPushToken, chunkPushNotifications, and
// sendPushNotificationsAsync.

const TOKEN_RE = /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/;

class Expo {
  constructor() {}

  static isExpoPushToken(token) {
    return typeof token === "string" && TOKEN_RE.test(token);
  }

  chunkPushNotifications(messages) {
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async sendPushNotificationsAsync(chunk) {
    return chunk.map((message) => ({
      status: "ok",
      id: `mock-ticket-${message.to}`,
    }));
  }
}

module.exports = { Expo };
