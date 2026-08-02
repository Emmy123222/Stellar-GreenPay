/**
 * src/services/push.js
 * Push notification service using Expo
 */
const { Expo } = require("expo-server-sdk");
const pool = require("../db/pool");

// Create a new Expo SDK client
const expo = new Expo();

/**
 * Push a single message to a single Expo push token.
 * Validates the token before sending.
 *
 * @param {string}  token  - Expo push token
 * @param {string}  title  - Notification title
 * @param {string}  body   - Notification body
 * @param {object}  [data] - Optional payload data
 */
async function sendPushToToken(token, title, body, data = {}) {
  if (!Expo.isExpoPushToken(token)) {
    console.error(`[Push] Invalid expo push token: ${token}`);
    return;
  }

  const message = {
    to: token,
    sound: "default",
    title,
    body,
    data,
  };

  try {
    const chunk = expo.chunkPushNotifications([message]);
    if (chunk.length > 0) {
      await expo.sendPushNotificationsAsync(chunk[0]);
      console.log(`[Push] Sent notification to token ${token.slice(0, 16)}...`);
    }
  } catch (error) {
    console.error("[Push] Error sending to token:", error);
  }
}

/**
 * Send push notifications to all device tokens following a project.
 *
 * @param {Object} params - { project, update }
 */
async function sendUpdatePushNotifications({ project, update }) {
  try {
    // Fetch all device tokens following this project
    const result = await pool.query(
      `SELECT dt.token, dt.platform 
       FROM project_follows pf
       JOIN device_tokens dt ON pf.device_token_id = dt.id
       WHERE pf.project_id = $1`,
      [project.id]
    );

    if (result.rows.length === 0) {
      console.log("[Push] No followers for project", project.id);
      return;
    }

    // Create push messages
    const messages = [];
    for (const row of result.rows) {
      // Check if the token is valid
      if (!Expo.isExpoPushToken(row.token)) {
        console.error(`[Push] Invalid push token: ${row.token}`);
        continue;
      }

      messages.push({
        to: row.token,
        sound: "default",
        title: `Update: ${project.name}`,
        body: update.title,
        data: {
          projectId: project.id,
          updateId: update.id,
          type: "project_update",
        },
      });
    }

    // Send notifications in chunks
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        console.log(`[Push] Sent ${tickets.length} notifications for project ${project.id}`);
      } catch (error) {
        console.error("[Push] Error sending chunk:", error);
      }
    }
  } catch (error) {
    console.error("[Push] Error sending push notifications:", error);
  }
}

/**
 * Send a recurring-donation reminder push notification to a donor.
 * Looks up the donor's registered device tokens and sends the reminder.
 *
 * @param {string} donorAddress - Stellar wallet address of the donor
 * @param {string} projectName  - Name of the project
 * @param {number} amountXlm    - Donation amount in XLM
 * @param {string} projectId    - Project UUID (for deep-link data)
 */
async function sendRecurringReminder(donorAddress, projectName, amountXlm, projectId) {
  try {
    const result = await pool.query(
      "SELECT token FROM device_tokens WHERE wallet_address = $1",
      [donorAddress],
    );

    if (result.rows.length === 0) {
      console.log(`[Push] No device tokens for donor ${donorAddress.slice(0, 8)}...`);
      return;
    }

    const title = "Recurring Donation Reminder";
    const body = "Your " + amountXlm + " XLM donation to " + projectName + " is due tomorrow. Tap to donate.";
    const data = {
      projectId,
      type: "recurring_reminder",
    };

    for (const row of result.rows) {
      await sendPushToToken(row.token, title, body, data);
    }
  } catch (error) {
    console.error("[Push] Error sending recurring reminder:", error);
  }
}

module.exports = {
  sendPushToToken,
  sendUpdatePushNotifications,
  sendRecurringReminder,
};
