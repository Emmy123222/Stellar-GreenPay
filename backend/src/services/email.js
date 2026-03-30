/**
 * src/services/email.js — Transactional email via Resend
 */
"use strict";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_ADDRESS   = process.env.EMAIL_FROM || "GreenPay <updates@greenpay.app>";
const APP_URL        = process.env.APP_URL || "http://localhost:3000";

/**
 * Send a project update notification to a list of subscriber emails.
 * Silently skips if RESEND_API_KEY is not configured.
 */
async function sendUpdateNotifications({ project, update, emails }) {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping notifications");
    return;
  }
  if (!emails || emails.length === 0) return;

  const projectUrl = `${APP_URL}/projects/${project.id}`;

  // Resend supports up to 50 recipients per call — batch if needed
  const BATCH = 50;
  for (let i = 0; i < emails.length; i += BATCH) {
    const batch = emails.slice(i, i + BATCH);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: batch,
        subject: `Update from ${project.name}: ${update.title}`,
        html: buildHtml({ project, update, projectUrl }),
        text: buildText({ project, update, projectUrl }),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend error (batch ${i / BATCH + 1}):`, body);
    }
  }
}

function buildHtml({ project, update, projectUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f0;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f0;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:#2d6a2d;padding:24px 32px;">
          <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">🌱 Stellar GreenPay</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 4px;font-size:13px;color:#8aaa8a;text-transform:uppercase;letter-spacing:.05em;">Project Update</p>
          <h1 style="margin:0 0 8px;font-size:22px;color:#1a3a1a;">${escHtml(update.title)}</h1>
          <p style="margin:0 0 24px;font-size:13px;color:#5a7a5a;">${escHtml(project.name)}</p>
          <p style="margin:0 0 28px;font-size:15px;color:#3a5a3a;line-height:1.6;">${escHtml(update.body)}</p>
          <a href="${projectUrl}" style="display:inline-block;background:#2d6a2d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View Project →</a>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e8f0e8;">
          <p style="margin:0;font-size:12px;color:#8aaa8a;">You're receiving this because you subscribed to updates for <strong>${escHtml(project.name)}</strong>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText({ project, update, projectUrl }) {
  return [
    `Project Update — ${project.name}`,
    ``,
    update.title,
    ``,
    update.body,
    ``,
    `View the project: ${projectUrl}`,
    ``,
    `You're receiving this because you subscribed to updates for ${project.name}.`,
  ].join("\n");
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { sendUpdateNotifications };
