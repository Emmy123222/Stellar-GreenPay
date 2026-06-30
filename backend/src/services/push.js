/**
 * src/services/push.js
 * Push notification service using Expo
 */
const { Expo } = require("expo-server-sdk");
const pool = require("../db/pool");

// Create a new Expo SDK client
const expo = new Expo();

/**
 * Send push notification to device tokens following a project
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

module.exports = {
  sendUpdatePushNotifications,
};
