/**
 * src/services/push.js
 * Push notification service using Expo
 */
const { Expo } = require("expo-server-sdk");
const pool = require("../db/pool");
const logger = require("../logger");

const expo = new Expo();

const RECEIPT_POLL_DELAY_MS = 2000;
const RECEIPT_POLL_ATTEMPTS = 3;

const FATAL_ERROR_CODES = new Set(["DeviceNotRegistered"]);

/**
 * Delete a device token (cascades to project_follows via FK).
 */
async function removeDeviceToken(token) {
  await pool.query("DELETE FROM device_tokens WHERE token = $1", [token]);
}

/**
 * Mark a token as successfully delivered.
 */
async function markDelivered(token) {
  await pool.query(
    "UPDATE device_tokens SET last_delivered_at = NOW() WHERE token = $1",
    [token]
  );
}

/**
 * Poll Expo receipts and handle delivery outcomes.
 * Called once per send batch.
 *
 * @param {object[]} tickets  - tickets returned by sendPushNotificationsAsync
 * @param {string[]} tokens   - the push tokens in the same order as the tickets
 */
async function processTickets(tickets, tokens) {
  if (!tickets || tickets.length === 0) return;

  const ticketIds = [];
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === "error" && ticket.message) {
      if (FATAL_ERROR_CODES.has(ticket.message)) {
        await removeDeviceToken(tokens[i]);
        logger.info(
          { event: "push_token_removed", token: tokens[i].slice(0, 16), reason: ticket.message },
          "[Push] Removed stale device token"
        );
      } else {
        logger.warn(
          { event: "push_ticket_error", token: tokens[i].slice(0, 16), error: ticket.message },
          "[Push] Ticket rejected"
        );
      }
    } else if (ticket.id) {
      ticketIds.push({ id: ticket.id, token: tokens[i] });
    }
  }

  if (ticketIds.length === 0) return;

  const idToToken = new Map(ticketIds.map((t) => [t.id, t.token]));

  for (let attempt = 0; attempt < RECEIPT_POLL_ATTEMPTS; attempt++) {
    if (idToToken.size === 0) return;
    const remainingIds = [...idToToken.keys()];
    if (remainingIds.length === 0) return;

    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_DELAY_MS));

    const receiptIdChunks = expo.chunkPushNotificationReceipts(remainingIds);
    for (const chunk of receiptIdChunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

        for (const [receiptId, receipt] of Object.entries(receipts)) {
          const token = idToToken.get(receiptId);
          if (!token) continue;

          if (receipt.status === "ok") {
            await markDelivered(token);
          } else if (receipt.status === "error" && receipt.message) {
            if (FATAL_ERROR_CODES.has(receipt.message)) {
              await removeDeviceToken(token);
              logger.info(
                { event: "push_token_removed", token: token.slice(0, 16), reason: receipt.message },
                "[Push] Removed stale device token (receipt)"
              );
            } else {
              logger.warn(
                { event: "push_receipt_error", token: token.slice(0, 16), error: receipt.message },
                "[Push] Receipt error (non-fatal)"
              );
            }
          }
          idToToken.delete(receiptId);
        }
      } catch (err) {
        logger.error({ event: "push_receipt_poll_error", err }, err.message);
      }
    }
  }
}

/**
 * Send a push notification to a single Expo push token.
 *
 * @param {string} token  - Expo push token
 * @param {string} title  - Notification title
 * @param {string} body   - Notification body
 * @param {object} [data] - Optional payload data
 */
async function sendPushToToken(token, title, body, data = {}) {
  if (!Expo.isExpoPushToken(token)) {
    logger.error({ event: "push_invalid_token", token }, "[Push] Invalid expo push token");
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
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      await processTickets(tickets, [token]);
    }
    logger.info({ event: "push_sent", token: token.slice(0, 16) }, "[Push] Sent notification");
  } catch (error) {
    logger.error({ event: "push_send_error", err: error }, error.message);
  }
}

/**
 * Send push notifications for a batch of already-built messages.
 * Tickets are matched positionally to the tokens in each chunk.
 *
 * @param {object[]} messages - Expo push messages
 * @param {string[]} tokens   - push tokens, same order as messages
 */
async function sendBatchedMessages(messages, tokens) {
  const chunks = expo.chunkPushNotifications(messages);
  let offset = 0;
  for (const chunk of chunks) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    await processTickets(tickets, tokens.slice(offset, offset + chunk.length));
    offset += chunk.length;
  }
}

/**
 * Deep-link payload so the app can navigate on tap (#1121).
 * `screen`/`params` are the canonical fields; `projectId` is kept for
 * backwards compatibility with builds from #483.
 */
function buildNotificationData(type, projectId, extra = {}) {
  const id = String(projectId);
  return {
    screen: "ProjectDetail",
    params: { projectId: id },
    projectId: id,
    type,
    ...extra,
  };
}

/**
 * Send a "donation confirmed" push to every device registered for the donor.
 *
 * @param {Object} params
 * @param {string} params.donorAddress - donor Stellar public key
 * @param {Object} params.project      - { id, name }
 * @param {Object} params.donation     - persisted donation row
 */
async function sendDonationConfirmedPush({ donorAddress, project, donation }) {
  try {
    const result = await pool.query(
      "SELECT token FROM device_tokens WHERE wallet_address = $1",
      [donorAddress]
    );

    if (result.rows.length === 0) {
      logger.info(
        { event: "push_donation_confirmed_no_device", donorAddress },
        "[Push] No devices for donation confirmation"
      );
      return;
    }

    const amount = donation.amount_xlm ?? donation.amount;
    const currency = donation.currency || "XLM";

    const messages = [];
    const validTokens = [];
    for (const row of result.rows) {
      if (!Expo.isExpoPushToken(row.token)) {
        logger.error({ event: "push_invalid_token", token: row.token }, "[Push] Invalid push token");
        continue;
      }
      messages.push({
        to: row.token,
        sound: "default",
        title: "Donation Confirmed!",
        body: `Your donation of ${amount} ${currency} to ${project.name} was confirmed. Tap to view the project.`,
        data: buildNotificationData("donation_confirmed", project.id, {
          donationId: donation.id,
        }),
      });
      validTokens.push(row.token);
    }

    if (messages.length === 0) return;

    await sendBatchedMessages(messages, validTokens);
    logger.info(
      { event: "push_donation_confirmed_sent", donationId: donation.id, count: messages.length },
      "[Push] Sent donation confirmation notifications"
    );
  } catch (error) {
    logger.error({ event: "push_donation_confirmed_error", err: error }, error.message);
  }
}

/**
 * Send push notifications to all device tokens following a project.
 *
 * @param {Object} params - { project, update }
 */
async function sendUpdatePushNotifications({ project, update }) {
  try {
    const result = await pool.query(
      `SELECT dt.token, dt.platform
       FROM project_follows pf
       JOIN device_tokens dt ON pf.device_token_id = dt.id
       WHERE pf.project_id = $1`,
      [project.id]
    );

    if (result.rows.length === 0) {
      logger.info({ event: "push_no_followers", projectId: project.id }, "[Push] No followers");
      return;
    }

    const messages = [];
    const validTokens = [];
    for (const row of result.rows) {
      if (!Expo.isExpoPushToken(row.token)) {
        logger.error({ event: "push_invalid_token", token: row.token }, "[Push] Invalid push token");
        continue;
      }
      messages.push({
        to: row.token,
        sound: "default",
        title: `Update: ${project.name}`,
        body: update.title,
        data: buildNotificationData("project_update", project.id, {
          updateId: update.id,
        }),
      });
      validTokens.push(row.token);
    }

    const allTickets = [];
    const allTokens = [];
    const chunks = expo.chunkPushNotifications(messages);
    for (let i = 0; i < chunks.length; i++) {
      const tickets = await expo.sendPushNotificationsAsync(chunks[i]);
      const chunkTokens = validTokens.slice(
        chunks.slice(0, i).reduce((sum, c) => sum + c.length, 0),
        chunks.slice(0, i).reduce((sum, c) => sum + c.length, 0) + chunks[i].length
      );
      allTickets.push(...tickets);
      allTokens.push(...chunkTokens);
    }

    await processTickets(allTickets, allTokens);
    logger.info(
      { event: "push_batch_sent", projectId: project.id, count: allTickets.length },
      `[Push] Sent ${allTickets.length} notifications for project ${project.id}`
    );
  } catch (error) {
    logger.error({ event: "push_batch_error", err: error }, error.message);
  }
}

/**
 * Send a push notification to project admin(s) when a donation is received.
 *
 * @param {Object} params - { projectId, projectName, amountXLM, donorBadge }
 */
async function sendDonationPushNotification({ projectId, projectName, amountXLM, donorBadge }) {
  try {
    const result = await pool.query(
      `SELECT dt.token, dt.platform
       FROM device_tokens dt
       WHERE dt.wallet_address = (SELECT wallet_address FROM projects WHERE id = $1)`,
      [projectId]
    );

    if (result.rows.length === 0) {
      logger.info({ event: "push_no_admin_tokens", projectId }, "[Push] No admin device tokens found");
      return;
    }

    const messages = [];
    const validTokens = [];
    for (const row of result.rows) {
      if (!Expo.isExpoPushToken(row.token)) {
        logger.error({ event: "push_invalid_token", token: row.token }, "[Push] Invalid push token");
        continue;
      }
      messages.push({
        to: row.token,
        sound: "default",
        title: `New Donation to ${projectName}`,
        body: `${donorBadge ? donorBadge + " donor" : "Someone"} donated ${amountXLM} XLM to your project.`,
        data: {
          projectId,
          type: "new_donation",
          amountXLM,
          donorBadge,
        },
      });
      validTokens.push(row.token);
    }

    const allTickets = [];
    const allTokens = [];
    const chunks = expo.chunkPushNotifications(messages);
    for (let i = 0; i < chunks.length; i++) {
      const tickets = await expo.sendPushNotificationsAsync(chunks[i]);
      const chunkTokens = validTokens.slice(
        chunks.slice(0, i).reduce((sum, c) => sum + c.length, 0),
        chunks.slice(0, i).reduce((sum, c) => sum + c.length, 0) + chunks[i].length
      );
      allTickets.push(...tickets);
      allTokens.push(...chunkTokens);
    }

    await processTickets(allTickets, allTokens);
    logger.info(
      { event: "push_donation_sent", projectId, count: allTickets.length },
      `[Push] Sent ${allTickets.length} donation notifications for project ${projectId}`
    );
  } catch (error) {
    logger.error({ event: "push_donation_error", projectId, err: error }, error.message);
    throw error;
  }
}

/**
 * Send a push notification reminder for an upcoming recurring donation.
 *
 * @param {Object} params - { token, donation }
 */
async function sendRecurringDonationReminder({ token, donation }) {
  try {
    if (!Expo.isExpoPushToken(token)) {
      logger.error({ event: "push_invalid_token", token }, "[Push] Invalid push token");
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
      title: "Recurring Donation Due Tomorrow",
      body: `Your ${frequencyLabel} donation of ${donation.amount_xlm} XLM to ${donation.project_name} is due tomorrow. Tap to donate.`,
      data: buildNotificationData("recurring_donation_reminder", donation.project_id, {
        recurringDonationId: donation.id,
      }),
    };

    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      await processTickets(tickets, [token]);
    }
    logger.info(
      { event: "push_recurring_reminder_sent", donationId: donation.id },
      "[Push] Sent recurring donation reminder"
    );
  } catch (error) {
    logger.error({ event: "push_recurring_reminder_error", err: error }, error.message);
  }
}

module.exports = {
  sendPushToToken,
  sendUpdatePushNotifications,
  sendRecurringDonationReminder,
  sendDonationPushNotification,
  processTickets,
};
