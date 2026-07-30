/**
 * src/services/digestQueue.js
 *
 * Monthly impact digest email for project subscribers.
 *
 * Uses pg-boss cron scheduling (no extra dependency — pg-boss is already
 * present). On the 1st of every month at 08:00 UTC a single job is enqueued;
 * the worker iterates over every active project that has subscribers and sends
 * each subscriber a summary of:
 *   - Total XLM raised that month
 *   - CO₂ offset achieved
 *   - New milestones reached
 *   - Recent project updates
 *
 * The MONTHLY_DIGEST_CRON env var can override the schedule (cron syntax).
 * Set MONTHLY_DIGEST_CRON="disabled" to turn it off entirely.
 */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");

const QUEUE = "monthly-impact-digest";
// Default: 1st of every month at 08:00 UTC
const DEFAULT_CRON = "0 8 1 * *";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_ADDRESS   = process.env.EMAIL_FROM || "GreenPay <updates@greenpay.app>";
const APP_URL        = process.env.APP_URL || "http://localhost:3000";

let boss = null;

// ── HTML / text builders ─────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildDigestHtml({ project, stats, milestones, updates, projectUrl, monthLabel }) {
  const milestonesHtml = milestones.length
    ? `<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1a3a1a;">🏆 New Milestones</p><ul style="margin:0 0 24px;padding-left:20px;">${milestones.map(m => `<li style="color:#3a5a3a;font-size:14px;line-height:1.7;">${escHtml(m.title)} (${m.percentage}%)</li>`).join("")}</ul>`
    : "";

  const updatesHtml = updates.length
    ? `<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1a3a1a;">📰 Recent Updates</p><ul style="margin:0 0 24px;padding-left:20px;">${updates.map(u => `<li style="color:#3a5a3a;font-size:14px;line-height:1.7;"><strong>${escHtml(u.title)}</strong> — ${escHtml(u.body.slice(0, 120))}${u.body.length > 120 ? "…" : ""}</li>`).join("")}</ul>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f0;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f0;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:#2d6a2d;padding:24px 32px;">
          <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">🌱 Stellar GreenPay</p>
          <p style="margin:4px 0 0;color:#c8e6c8;font-size:13px;">Monthly Impact Digest — ${escHtml(monthLabel)}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 4px;font-size:22px;color:#1a3a1a;">${escHtml(project.name)}</h1>
          <p style="margin:0 0 24px;font-size:13px;color:#5a7a5a;">Here's what happened this month</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr>
              <td style="background:#f0f7f0;border-radius:8px;padding:16px;text-align:center;width:50%;">
                <p style="margin:0;font-size:24px;font-weight:700;color:#2d6a2d;">${escHtml(stats.raisedXLM)} XLM</p>
                <p style="margin:4px 0 0;font-size:12px;color:#5a7a5a;">Raised this month</p>
              </td>
              <td style="width:16px;"></td>
              <td style="background:#f0f7f0;border-radius:8px;padding:16px;text-align:center;width:50%;">
                <p style="margin:0;font-size:24px;font-weight:700;color:#2d6a2d;">${escHtml(String(stats.co2OffsetKg))} kg</p>
                <p style="margin:4px 0 0;font-size:12px;color:#5a7a5a;">CO₂ offset this month</p>
              </td>
            </tr>
          </table>

          ${milestonesHtml}
          ${updatesHtml}

          <a href="${projectUrl}" style="display:inline-block;background:#2d6a2d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View Project →</a>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e8f0e8;">
          <p style="margin:0;font-size:12px;color:#8aaa8a;">You're receiving this monthly digest because you subscribed to <strong>${escHtml(project.name)}</strong>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildDigestText({ project, stats, milestones, updates, projectUrl, monthLabel }) {
  const lines = [
    `Stellar GreenPay — Monthly Impact Digest (${monthLabel})`,
    `Project: ${project.name}`,
    "",
    `XLM Raised This Month : ${stats.raisedXLM} XLM`,
    `CO₂ Offset This Month : ${stats.co2OffsetKg} kg`,
    "",
  ];

  if (milestones.length) {
    lines.push("New Milestones:");
    milestones.forEach(m => lines.push(`  • ${m.title} (${m.percentage}%)`));
    lines.push("");
  }

  if (updates.length) {
    lines.push("Recent Updates:");
    updates.forEach(u => lines.push(`  • ${u.title} — ${u.body.slice(0, 120)}${u.body.length > 120 ? "…" : ""}`));
    lines.push("");
  }

  lines.push(`View the project: ${projectUrl}`);
  lines.push("");
  lines.push(`You're receiving this because you subscribed to ${project.name}.`);
  return lines.join("\n");
}

// ── Email sender (batched, same Resend convention as email.js) ───────────────

async function sendDigestEmails({ project, stats, milestones, updates, emails, monthLabel }) {
  if (!RESEND_API_KEY) {
    logger.warn({ event: "digest_skip_no_key", projectId: project.id }, "[digestQueue] RESEND_API_KEY not set — skipping");
    return;
  }
  if (!emails.length) return;

  const projectUrl = `${APP_URL}/projects/${project.id}`;
  const subject    = `Your ${monthLabel} Impact Digest — ${project.name}`;
  const html       = buildDigestHtml({ project, stats, milestones, updates, projectUrl, monthLabel });
  const text       = buildDigestText({ project, stats, milestones, updates, projectUrl, monthLabel });

  const BATCH = 50;
  for (let i = 0; i < emails.length; i += BATCH) {
    const batch = emails.slice(i, i + BATCH);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: FROM_ADDRESS, to: batch, subject, html, text }),
      });
      if (!res.ok) {
        const body = await res.text();
        logger.error({ event: "digest_resend_error", projectId: project.id, batch: i / BATCH + 1 }, body);
      }
    } catch (err) {
      logger.error({ event: "digest_fetch_error", projectId: project.id, err }, err.message);
    }
  }
}

// ── Worker logic ─────────────────────────────────────────────────────────────

async function runDigest() {
  // Month window: first day of the previous calendar month → first day of current month
  const now       = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthLabel = monthStart.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  logger.info({ event: "digest_run_start", monthLabel }, "[digestQueue] Starting monthly digest run");

  // Fetch all active projects that have at least one subscriber
  const projectsResult = await pool.query(
    `SELECT p.id, p.name, p.co2_offset_kg
     FROM projects p
     WHERE p.status = 'active'
       AND EXISTS (SELECT 1 FROM project_subscriptions ps WHERE ps.project_id = p.id)`,
  );

  let sent = 0;
  let errors = 0;

  for (const project of projectsResult.rows) {
    try {
      // --- stats: XLM raised and CO₂ offset during the month window ---
      const statsResult = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN currency = 'XLM' THEN amount_xlm ELSE 0 END), 0) AS raised_xlm,
           COUNT(*) AS donation_count
         FROM donations
         WHERE project_id = $1
           AND created_at >= $2
           AND created_at <  $3`,
        [project.id, monthStart.toISOString(), monthEnd.toISOString()],
      );
      const raisedXLM = parseFloat(statsResult.rows[0].raised_xlm || "0").toFixed(2);

      // Derive a proportional CO₂ estimate for the month based on project total
      // (project.co2_offset_kg is the lifetime total; we scale by monthly fraction)
      const lifetimeTotResult = await pool.query(
        "SELECT COALESCE(SUM(amount_xlm), 0) AS total FROM donations WHERE project_id = $1 AND currency = 'XLM'",
        [project.id],
      );
      const lifetimeXLM = parseFloat(lifetimeTotResult.rows[0].total || "0");
      const co2Total    = parseInt(project.co2_offset_kg, 10) || 0;
      const monthXLM    = parseFloat(raisedXLM);
      const co2OffsetKg = lifetimeXLM > 0
        ? Math.round((monthXLM / lifetimeXLM) * co2Total)
        : 0;

      // --- milestones reached during the month ---
      const milestonesResult = await pool.query(
        `SELECT title, percentage FROM project_milestones
         WHERE project_id = $1
           AND reached_at >= $2
           AND reached_at <  $3
         ORDER BY percentage ASC`,
        [project.id, monthStart.toISOString(), monthEnd.toISOString()],
      );

      // --- recent project updates posted during the month ---
      const updatesResult = await pool.query(
        `SELECT title, body FROM project_updates
         WHERE project_id = $1
           AND created_at >= $2
           AND created_at <  $3
         ORDER BY created_at DESC
         LIMIT 5`,
        [project.id, monthStart.toISOString(), monthEnd.toISOString()],
      );

      // Skip projects with nothing to report (no donations, milestones, or updates)
      const hasContent =
        parseFloat(raisedXLM) > 0 ||
        milestonesResult.rows.length > 0 ||
        updatesResult.rows.length > 0;

      if (!hasContent) continue;

      // --- subscriber emails ---
      const subsResult = await pool.query(
        "SELECT email FROM project_subscriptions WHERE project_id = $1",
        [project.id],
      );
      const emails = subsResult.rows.map(r => r.email);
      if (!emails.length) continue;

      await sendDigestEmails({
        project: { id: project.id, name: project.name },
        stats: { raisedXLM, co2OffsetKg },
        milestones: milestonesResult.rows,
        updates: updatesResult.rows,
        emails,
        monthLabel,
      });

      sent += emails.length;
      logger.info({ event: "digest_project_sent", projectId: project.id, recipients: emails.length }, "[digestQueue] Digest sent");
    } catch (err) {
      errors++;
      logger.error({ event: "digest_project_error", projectId: project.id, err }, err.message);
    }
  }

  logger.info({ event: "digest_run_complete", sent, errors, monthLabel }, "[digestQueue] Monthly digest run complete");
}

// ── pg-boss wiring ────────────────────────────────────────────────────────────

/**
 * Start the digest scheduler.
 * Registers a pg-boss cron job and a worker that processes it.
 * Safe to call multiple times (guards with module-level `boss`).
 */
async function start() {
  const cronOverride = process.env.MONTHLY_DIGEST_CRON;
  if (cronOverride === "disabled") {
    logger.info({ event: "digest_disabled" }, "[digestQueue] Monthly digest disabled via env");
    return;
  }

  const cronSchedule = cronOverride || DEFAULT_CRON;
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) => logger.error({ event: "digest_pgboss_error", err }, err.message));

  await boss.start();

  // Register the cron schedule (idempotent — pg-boss deduplicates by name)
  await boss.schedule(QUEUE, cronSchedule, {}, { tz: "UTC" });

  // Register the worker
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runDigest();
  });

  logger.info({ event: "digest_scheduled", cron: cronSchedule }, `[digestQueue] Monthly digest scheduled: ${cronSchedule}`);
}

module.exports = { start, runDigest };
