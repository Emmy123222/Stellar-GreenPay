/**
 * backend/src/services/donationPushQueue.js
 * Queue for sending push notifications to project admins when donations are received.
 *
 * Uses pg-boss to enqueue and process donation push notification jobs asynchronously,
 * ensuring the donation API response time is not affected by notification delivery.
 */
"use strict";

const PgBoss = require("pg-boss");
const logger = require("../logger");
const Sentry = require("@sentry/node");

const QUEUE = "donation-push-notification";

let boss = null;

/**
 * Process一个 donation push notification job.
 *
 * @param {object} job - pg-boss job object
 * @param {object} job.data - Job data containing { projectId, projectName, amountXLM, donorBadge }
 */
async function processDonationPushNotification(job) {
  const { projectId, projectName, amountXLM, donorBadge } = job.data;

  try {
    // eslint-disable-next-line global-require
    const { sendDonationPushNotification } = require("./push");

    await sendDonationPushNotification({
      projectId,
      projectName,
      amountXLM,
      donorBadge,
    });

    logger.info(
      { event: "donation_push_processed", projectId, jobId: job.id },
      `[DonationPushQueue] Processed push notification for project ${projectId}`
    );
  } catch (error) {
    logger.error(
      { event: "donation_push_error", projectId, jobId: job.id, err: error },
      `[DonationPushQueue] Failed to send push notification for project ${projectId}: ${error.message}`
    );

    // Log to Sentry without propagating error
    Sentry.captureException(error, {
      tags: {
        projectId,
        queue: QUEUE,
      },
      extra: {
        projectName,
        amountXLM,
        donorBadge,
      },
    });

    // Re-throw to let pg-boss handle retries
    throw error;
  }
}

/**
 * Start the donation push notification queue worker.
 *
 * @returns {Promise<void>}
 */
async function start() {
  if (boss) return;

  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) =>
    logger.error({ event: "donation_push_pgboss_error", err }, err.message),
  );

  await boss.start();
  await boss.work(QUEUE, { teamSize: 2, teamConcurrency: 1 }, processDonationPushNotification);

  logger.info(
    { event: "donation_push_queue_started" },
    "[DonationPushQueue] Donation push notification queue worker started"
  );
}

/**
 * Enqueue a donation push notification job.
 *
 * @param {object} data - Job data { projectId, projectName, amountXLM, donorBadge }
 * @returns {Promise<string>} Job ID
 */
async function enqueueDonationPushNotification(data) {
  if (!boss) {
    logger.warn({ event: "donation_push_queue_not_started" }, "[DonationPushQueue] Queue not started, skipping enqueue");
    return null;
  }

  try {
    const jobId = await boss.send(QUEUE, data);
    logger.info(
      { event: "donation_push_enqueued", projectId: data.projectId, jobId },
      "[DonationPushQueue] Enqueued push notification for project"
    );
    return jobId;
  } catch (error) {
    logger.error(
      { event: "donation_push_enqueue_error", projectId: data.projectId, err: error },
      `[DonationPushQueue] Failed to enqueue push notification: ${error.message}`
    );

    // Log to Sentry without propagating error
    Sentry.captureException(error, {
      tags: {
        projectId: data.projectId,
        queue: QUEUE,
      },
      extra: data,
    });

    return null;
  }
}

module.exports = {
  start,
  enqueueDonationPushNotification,
  QUEUE,
};
