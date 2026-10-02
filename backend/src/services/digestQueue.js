/** Weekly project-update digest for subscribed donors. */
"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const logger = require("../logger");
const { signUnsubscribeToken } = require("./unsubscribeToken");

const QUEUE = "weekly-project-update-digest";
const DEFAULT_CRON = "0 8 * * 1"; // Monday 08:00 UTC
let boss = null;

function escHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A donor receives one email containing updates from every subscribed project. */
function buildDigestHtml({ projects, weekLabel, unsubscribeUrl, project, updates = [], monthLabel, stats, milestones = [] }) {
  // Keep the admin preview endpoint compatible while it is migrated to weekly previews.
  if (!projects && stats) {
    return `<!doctype html><html><body><h1>Monthly Impact Digest — ${escHtml(monthLabel || "Preview")}</h1><h2>${escHtml(project.name)}</h2><p>${escHtml(stats.raisedXLM)} XLM</p><ul>${milestones.map((m) => `<li>${escHtml(m.title)}</li>`).join("")}</ul></body></html>`;
  }
  projects = projects || [{ project, updates: updates.map((update) => ({ ...update, id: update.id || "" })), unsubscribeUrl: "#" }];
  weekLabel = weekLabel || monthLabel || "Preview";
  unsubscribeUrl = unsubscribeUrl || "#";
  const projectBlocks = projects.map(({ project, updates, unsubscribeUrl: projectUnsubscribeUrl }) => `
    <section style="margin:0 0 28px"><h2 style="margin:0 0 10px;color:#1a3a1a;font-size:20px">${escHtml(project.name)}</h2>
    ${updates.map((update) => `<article style="margin:0 0 14px"><strong style="color:#2d6a2d">${escHtml(update.title)}</strong><p style="margin:5px 0;color:#3a5a3a;line-height:1.5">${escHtml(update.body.slice(0, 180))}${update.body.length > 180 ? "…" : ""}</p><a href="${escHtml(update.url)}" style="color:#2d6a2d">Read the full update →</a></article>`).join("")}
    <a href="${escHtml(projectUnsubscribeUrl)}" style="font-size:12px;color:#5a7a5a">Unsubscribe from ${escHtml(project.name)}</a></section>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f0f7f0;font-family:sans-serif"><main style="max-width:600px;margin:auto;background:#fff;padding:32px;border-radius:12px"><header style="margin:-32px -32px 28px;padding:24px 32px;background:#2d6a2d;color:#fff"><strong style="font-size:20px">🌱 Stellar GreenPay</strong><p style="margin:6px 0 0">Weekly project updates — ${escHtml(weekLabel)}</p></header>${projectBlocks}<footer style="border-top:1px solid #e8f0e8;padding-top:16px;font-size:12px;color:#5a7a5a">You receive this email because you subscribed to these projects. <a href="${escHtml(unsubscribeUrl)}">Manage subscriptions</a>.</footer></main></body></html>`;
}

function buildDigestText({ projects, weekLabel, unsubscribeUrl, project, updates = [], monthLabel, stats }) {
  if (!projects && stats) return `Monthly Impact Digest — ${monthLabel || "Preview"}\n${project.name}\n${stats.raisedXLM} XLM`;
  projects = projects || [{ project, updates: updates.map((update) => ({ ...update, id: update.id || "" })) }];
  weekLabel = weekLabel || monthLabel || "Preview";
  unsubscribeUrl = unsubscribeUrl || "#";
  const lines = [`Stellar GreenPay — Weekly project updates (${weekLabel})`, ""];
  projects.forEach(({ project, updates }) => {
    lines.push(project.name);
    updates.forEach((u) => lines.push(`• ${u.title}: ${u.body.slice(0, 180)}\n  ${u.url}`));
    lines.push("");
  });
  lines.push(`Manage subscriptions: ${unsubscribeUrl}`);
  return lines.join("\n");
}

async function sendDigestEmail(email, projects, weekLabel) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const decorated = projects.map(({ project, updates }) => ({ project, updates: updates.map((u) => ({ ...u, url: `${appUrl}/projects/${project.id}/updates/${u.id}` })), unsubscribeUrl: `${apiUrl}/api/subscriptions/unsubscribe?token=${signUnsubscribeToken(email, project.id)}` }));
  const unsubscribeUrl = `${appUrl}/settings/notifications?email=${encodeURIComponent(email)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "GreenPay <updates@greenpay.app>", to: email, subject: `Your weekly project updates — ${weekLabel}`, html: buildDigestHtml({ projects: decorated, weekLabel, unsubscribeUrl }), text: buildDigestText({ projects: decorated, weekLabel, unsubscribeUrl }) }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${await response.text()}`);
  return true;
}

async function runDigest(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekLabel = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}–${new Date(end.getTime() - 1).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  const result = await pool.query(`SELECT ps.email, p.id AS project_id, p.name, u.id AS update_id, u.title, u.body
    FROM project_subscriptions ps JOIN projects p ON p.id = ps.project_id JOIN project_updates u ON u.project_id = p.id
    WHERE (ps.unsubscribed = false OR ps.unsubscribed IS NULL) AND u.created_at >= $1 AND u.created_at < $2
    ORDER BY ps.email, p.name, u.created_at DESC`, [start.toISOString(), end.toISOString()]);
  const donors = new Map();
  result.rows.forEach((row) => {
    const projects = donors.get(row.email) || new Map();
    const entry = projects.get(row.project_id) || { project: { id: row.project_id, name: row.name }, updates: [] };
    entry.updates.push({ id: row.update_id, title: row.title, body: row.body }); projects.set(row.project_id, entry); donors.set(row.email, projects);
  });
  let sent = 0;
  for (const [email, projectMap] of donors) {
    try { if (await sendDigestEmail(email, [...projectMap.values()], weekLabel)) sent++; }
    catch (err) { logger.error({ event: "weekly_digest_send_error", email, err }, err.message); }
  }
  logger.info({ event: "weekly_digest_complete", sent, donors: donors.size }, "Weekly update digest complete");
  return { sent, donors: donors.size };
}

async function start() {
  const cron = process.env.WEEKLY_DIGEST_CRON;
  if (cron === "disabled") return;
  boss = new PgBoss(process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay");
  boss.on("error", (err) => logger.error({ event: "weekly_digest_pgboss_error", err }, err.message));
  await boss.start(); await boss.schedule(QUEUE, cron || DEFAULT_CRON, {}, { tz: "UTC" });
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, () => runDigest());
}

module.exports = { start, runDigest, buildDigestHtml, buildDigestText };
