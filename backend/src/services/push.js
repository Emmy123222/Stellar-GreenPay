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
 * Send a push notification reminder for an upcoming recurring donation
 * @param {Object} params - { token, donation }
 */
async function sendRecurringDonationReminder({ token, donation }) {
  try {
    if (!Expo.isExpoPushToken(token)) {
      console.error(`[Push] Invalid push token: ${token}`);
      return;
    }

    const frequencyLabel =
      donation.frequency === "monthly" ? "monthly" :
        donation.frequency === "weekly" ? "weekly" :
          donation.frequency === "yearly" ? "yearly" :
            donation.frequency;

    const message = {
      to: token,
      sound: "default",
      title: "💚 Recurring Donation Due Tomorrow",
      body: `Your ${frequencyLabel} donation of ${donation.amount_xlm} XLM to ${donation.project_name} is due tomorrow. Tap to donate.`,
      data: {
        projectId: donation.project_id,
        recurringDonationId: donation.id,
        type: "recurring_donation_reminder",
      },
    };

    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        console.log(`[Push] Sent recurring donation reminder for ${donation.id}`);
      } catch (error) {
        console.error("[Push] Error sending recurring donation reminder chunk:", error);
      }
    }
  } catch (error) {
    console.error("[Push] Error sending recurring donation reminder:", error);
  }
}

module.exports = {
  sendPushToToken,
  sendUpdatePushNotifications,
  sendRecurringDonationReminder,
};
