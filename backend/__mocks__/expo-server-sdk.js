"use strict";
// CJS shim for expo-server-sdk v6, which ships pure ESM and cannot be
// require()'d under Jest's CommonJS transform. Network calls are stubbed;
// push behavior is covered with service-level mocks in push.test.js.

const CHUNK_SIZE = 100;

function chunk(items) {
  const chunks = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

class Expo {
  static isExpoPushToken(token) {
    return (
      typeof token === "string" &&
      ((token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")) &&
        token.endsWith("]") ||
        /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(token))
    );
  }

  chunkPushNotifications(messages) {
    return chunk(messages);
  }

  chunkPushNotificationReceipts(receiptIds) {
    return chunk(receiptIds);
  }

  async sendPushNotificationsAsync() {
    return [];
  }

  async getPushNotificationReceiptsAsync() {
    return {};
  }
}

module.exports = { Expo };
