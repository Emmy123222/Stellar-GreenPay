/**
 * src/services/summaryQueue.js
 *
 * pg-boss job queue for async AI summary generation.
 * Keeps the HTTP request lifecycle decoupled from the Claude API call.
 */
"use strict";

const crypto = require("crypto");
const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const { generateProjectSummary } = require("./claude");
const { logAdminAction } = require("./audit");

const QUEUE = "ai-summary";

const activeJobs = new Set();
const lastRunMap = new Map();
const FIVE_MINUTES_MS = 5 * 60 * 1000;


let boss = null;

/**
 * Start the pg-boss scheduler and register the AI-summary worker.
 * Must be called after database migrations and before the HTTP server starts
 * accepting requests.
 *
 * @param {import('socket.io').Server} io  Socket.IO server instance
 */
async function start(io) {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);

  boss.on("error", (err) => console.error("[summaryQueue] pg-boss error:", err.message));

  await boss.start();

  await boss.work(QUEUE, { teamSize: 2, teamConcurrency: 1 }, async (job) => {
    const { projectId, name, category, description, adminAddress } = job.data;

    let summaryResult;
    try {
      summaryResult = await generateProjectSummary({ name, category, description });
    } catch (err) {
      if (err.code === "MISSING_API_KEY") {
        // Permanent misconfiguration — log and give up without retrying.
        console.error("[summaryQueue] ANTHROPIC_API_KEY not set; skipping job", projectId);
        return;
      }
      throw err; // pg-boss will retry according to retryLimit
    }

    const sourceHash = crypto
      .createHash("sha256")
      .update(description || "")
      .digest("hex");

    const updated = await pool.query(
      `UPDATE projects
          SET ai_summary              = $1,
              ai_summary_generated_at = NOW(),
              ai_summary_model        = $2,
              ai_summary_source_hash  = $3,
              updated_at              = NOW()
        WHERE id = $4
        RETURNING ai_summary, ai_summary_generated_at, ai_summary_model`,
      [summaryResult.summary, summaryResult.model, sourceHash, projectId],
    );

    const row = updated.rows[0];
    if (!row) return; // project was deleted while job was queued

    if (io) {
      const summaryPayload = {
        projectId,
        aiSummary:            row.ai_summary,
        aiSummaryGeneratedAt: new Date(row.ai_summary_generated_at).toISOString(),
        aiSummaryModel:       row.ai_summary_model,
      };
      if (typeof io.to === "function") {
        io.to(`project:${projectId}`).emit("ai_summary_ready", summaryPayload);
      } else if (typeof io.emit === "function") {
        io.emit("ai_summary_ready", summaryPayload);
      }
    }

    lastRunMap.set(projectId, Date.now());
    activeJobs.delete(projectId);

    logAdminAction({
      actor: adminAddress || "system",
      action: "project.summary.generated",
      targetType: "project",
      targetId: projectId,
      metadata: { model: summaryResult.model },
      ipAddress: null,
    });
  });

  console.log("[summaryQueue] pg-boss started, worker registered on queue:", QUEUE);
}

/**
 * Enqueue an AI summary generation job.
 *
 * @param {string} projectId
 * @param {{ name: string, category: string, description: string, adminAddress?: string }} projectData
 * @returns {Promise<string>} job ID
 */

// Track active/queued jobs and last execution time per project
const activeJobs = new Set();
const lastRunMap = new Map();
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Enqueue an AI summary generation job with deduplication and 5-min rate limiting per project.
 *
 * @param {string} projectId
 * @param {{ name: string, category: string, description: string, adminAddress?: string }} projectData
 * @returns {Promise<string|null>} job ID or null if skipped
 */

async function enqueueAISummary(projectId, projectData) {
  if (!boss) {
    throw new Error("summaryQueue not started — call start(io) first");
  }

  // 1. Deduplicate: Skip if a summary job for this project is already queued/running
  if (activeJobs.has(projectId)) {
    console.info(`[summaryQueue] [INFO] Job for project ${projectId} already queued/running; skipping.`);
    return null;
  }

  // 2. Cooldown: Skip if less than 5 minutes have elapsed since last summary generation
  const lastRun = lastRunMap.get(projectId) || 0;
  if (Date.now() - lastRun < FIVE_MINUTES_MS) {
    console.info(`[summaryQueue] [INFO] Job for project ${projectId} rate limited (5-min cooldown); skipping.`);
    return null;
  }

  activeJobs.add(projectId);

  try {
    const jobId = await boss.send(
      QUEUE,
      { projectId, ...projectData },
      { retryLimit: 3, retryDelay: 10, singletonKey: `summary-${projectId}` }
    );
    return jobId;
  } catch (err) {
    activeJobs.delete(projectId);
    throw err;
  }
}

module.exports = { start, enqueueAISummary };
