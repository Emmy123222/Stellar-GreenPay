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
        // sanitizeHeader keeps CRLF out of subject in case project name /
        // update title are ever sourced from non-admin content in the future.
        subject: `Update from ${sanitizeHeader(project.name)}: ${sanitizeHeader(update.title)}`,
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

/**
 * Send update notification emails for a project using Resend.
 *
 * @param {{project:object,update:object,emails:string[]}} opts
 * @param {object} opts.project - Project object with at least `id` and `name`.
 * @param {object} opts.update - Update object with `title` and `body`.
 * @param {string[]} opts.emails - Array of recipient email addresses.
 * @returns {Promise<void>} Resolves when all batches have been attempted.
 * @throws {Error} When the Resend API returns an unexpected failure (logged and not rethrown here).
 */
// exported as `sendUpdateNotifications`

const ADMIN_NOTIFICATION_EMAIL =
  process.env.ADMIN_NOTIFICATION_EMAIL || process.env.EMAIL_FROM || "GreenPay <updates@greenpay.app>";

/**
 * Notify platform admins that a new verification request has been submitted
 * via the /apply form. Silent no-op if RESEND_API_KEY isn't configured —
 * callers (routes/verification.js) deliberately don't await this so the
 * submitter still receives a 201 response even if Resend is down.
 *
 * @param {object} request - The mapped verification_requests row.
 * @returns {Promise<void>} Resolves when the email has been dispatched (or
 * silently skipped when no API key is configured).
 */
async function sendAdminVerificationNotification(request) {
  if (!RESEND_API_KEY) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[email] RESEND_API_KEY not set — skipping admin verification notification",
      );
    }
    return;
  }
  if (!request || typeof request !== "object") return;

  // Strip CR/LF from user-controlled segments to prevent SMTP header
  // injection (e.g. `Org\r\nBcc: attacker@evil.com`). Resend rejects these
  // headers if it sees them, so sanitising is belt-and-braces.
  const subject  = `New verification request: ${sanitizeHeader(request.projectName)} (${sanitizeHeader(request.organizationName)})`;
  const adminUrl = `${(APP_URL || "").replace(/\/$/, "")}/admin/verification/${request.id}`;
  const body = buildVerificationHtml({ request, adminUrl });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [ADMIN_NOTIFICATION_EMAIL],
      subject,
      html: body,
      text: buildVerificationText({ request, adminUrl }),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[email] Resend error (verification notification):", errBody);
  }
}

function buildVerificationHtml({ request, adminUrl }) {
  const docsList =
    request.supportingDocuments && request.supportingDocuments.length
      ? `<ul>${request.supportingDocuments
          .map(
            (d) =>
              `<li><a href="${escHtml(d.url)}">${escHtml(d.name)}</a>${d.size ? ` (${(d.size / 1024).toFixed(1)} KB)` : ""}</li>`,
          )
          .join("")}</ul>`
      : "<p><em>No documents attached.</em></p>";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f0;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f0;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:#2d6a2d;padding:24px 32px;">
          <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">🌱 New Verification Request</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 4px;font-size:13px;color:#8aaa8a;text-transform:uppercase;letter-spacing:.05em;">Stellar GreenPay</p>
          <h1 style="margin:0 0 16px;font-size:22px;color:#1a3a1a;">${escHtml(request.projectName)}</h1>
          <table cellpadding="6" cellspacing="0" style="font-size:14px;color:#3a5a3a;width:100%;margin-bottom:20px;">
            <tr><td style="color:#8aaa8a;width:160px;">Organisation</td><td><strong>${escHtml(request.organizationName)}</strong></td></tr>
            ${request.organizationWebsite ? `<tr><td style="color:#8aaa8a;">Website</td><td><a href="${escHtml(request.organizationWebsite)}" style="color:#2d6a2d;">${escHtml(request.organizationWebsite)}</a></td></tr>` : ""}
            ${request.organizationCountry ? `<tr><td style="color:#8aaa8a;">Country</td><td>${escHtml(request.organizationCountry)}</td></tr>` : ""}
            <tr><td style="color:#8aaa8a;">Contact email</td><td>${escHtml(request.contactEmail)}</td></tr>
            <tr><td style="color:#8aaa8a;">Wallet address</td><td style="font-family:monospace;font-size:12px;color:#1a3a1a;">${escHtml(request.walletAddress)}</td></tr>
            <tr><td style="color:#8aaa8a;">Project category</td><td>${escHtml(request.projectCategory)}</td></tr>
            <tr><td style="color:#8aaa8a;">Project location</td><td>${escHtml(request.projectLocation)}</td></tr>
            <tr><td style="color:#8aaa8a;">Expected CO₂ per XLM</td><td><strong>${escHtml(request.co2PerXLM)} kg</strong></td></tr>
            ${request.expectedAnnualTonnesCO2 ? `<tr><td style="color:#8aaa8a;">Annual tonnes CO₂</td><td>${escHtml(request.expectedAnnualTonnesCO2)}</td></tr>` : ""}
          </table>
          <p style="margin:0 0 6px;font-size:13px;color:#8aaa8a;text-transform:uppercase;letter-spacing:.05em;">Supporting documents</p>
          ${docsList}
          ${request.projectDescription ? `<p style="margin:20px 0 0;font-size:14px;color:#3a5a3a;line-height:1.6;">${escHtml(request.projectDescription)}</p>` : ""}
          <a href="${adminUrl}" style="display:inline-block;margin-top:24px;background:#2d6a2d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Review in Admin →</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildVerificationText({ request, adminUrl }) {
  const docs =
    request.supportingDocuments && request.supportingDocuments.length
      ? request.supportingDocuments.map((d) => `  - ${d.name}: ${d.url}`).join("\n")
      : "  (none)";
  return [
    `New verification request — ${request.projectName}`,
    "",
    `Organisation: ${request.organizationName}`,
    `Website:      ${request.organizationWebsite || "(none)"}`,
    `Country:      ${request.organizationCountry || "(n/a)"}`,
    `Contact:      ${request.contactEmail}`,
    `Wallet:       ${request.walletAddress}`,
    `Category:     ${request.projectCategory}`,
    `Location:     ${request.projectLocation}`,
    `CO₂ / XLM:    ${request.co2PerXLM} kg`,
    `Annual tCO₂:  ${request.expectedAnnualTonnesCO2 || "(n/a)"}`,
    "",
    "Supporting documents:",
    docs,
    "",
    request.projectDescription ? `Description:\n${request.projectDescription}\n` : "",
    `Review in admin: ${adminUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
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
    "",
    update.title,
    "",
    update.body,
    "",
    `View the project: ${projectUrl}`,
    "",
    `You're receiving this because you subscribed to updates for ${project.name}.`,
  ].join("\n");
}

/**
 * Strip CR/LF from a string to keep user-controlled text out of
 * RFC-822 headers (SMTP header injection). Applied everywhere we
 * interpolate a requester's free-text input into a Subject line.
 */
function sanitizeHeader(str) {
  return String(str == null ? "" : str).replace(/[\r\n]+/g, " ").trim();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send a status-change notification to the submitter when an admin
 * transitions a verification request to approved, rejected, or in_review.
 * Fire-and-forget from the route layer — Resend failures must not block
 * the PATCH response.
 *
 * @param {object} request - The mapped verification_requests row.
 * @param {string} newStatus - The target status (approved|rejected|in_review).
 * @returns {Promise<void>} Resolves when the email has been dispatched (or
 * silently skipped when no API key is configured).
 */
async function sendVerificationStatusNotification(request, newStatus) {
  if (!RESEND_API_KEY) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[email] RESEND_API_KEY not set — skipping status-change notification");
    }
    return;
  }
  if (!request || typeof request !== "object" || !request.contactEmail) return;

  const recipient = request.contactEmail;
  const subject = `Verification status update: ${sanitizeHeader(request.projectName)} is now ${newStatus}`;

  const adminUrl = `${(APP_URL || "").replace(/\/$/, "")}/admin/verification/${request.id}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [recipient],
      subject,
      html: buildStatusChangeHtml({ request, newStatus, adminUrl }),
      text: buildStatusChangeText({ request, newStatus, adminUrl }),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[email] Resend error (status-change notification):", errBody);
  }
}

function buildStatusChangeHtml({ request, newStatus, adminUrl }) {
  const statusLabel = { approved: "Approved ✅", rejected: "Not Approved", in_review: "Under Review 🔍" }[newStatus] || newStatus;
  const statusColor = { approved: "#2d6a2d", rejected: "#c53030", in_review: "#2b6cb0" }[newStatus] || "#2d6a2d";

  let nextStepsHtml = "";
  if (newStatus === "approved") {
    nextStepsHtml = `
      <div style="background:#f0faf0;border-radius:8px;margin-top:20px;padding:16px 20px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#1a3a1a;">Next Steps</p>
        <p style="margin:6px 0 0;font-size:14px;color:#3a5a3a;">Your project has been approved! To complete on-chain registration, use the admin register endpoint:</p>
        <p style="margin:8px 0 0;font-family:monospace;font-size:13px;background:#ffffff;padding:8px;border-radius:4px;border:1px solid #e2e8e2;color:#1a3a1a;">POST ${escHtml(APP_URL)}/api/projects/admin/register</p>
        <p style="margin:4px 0 0;font-size:13px;color:#5a7a5a;">See <a href="${escHtml(APP_URL)}/api-docs" style="color:#2d6a2d;">API docs</a> for the full request shape.</p>
      </div>`;
  } else if (newStatus === "rejected") {
    nextStepsHtml = `
      <div style="background:#fff5f5;border-radius:8px;margin-top:20px;padding:16px 20px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#742a2a;">Next Steps</p>
        <p style="margin:6px 0 0;font-size:14px;color:#5a3a3a;">Your submission was not approved at this time. You may address the reviewer notes below and re-submit via the <a href="${escHtml(APP_URL)}/apply" style="color:#2d6a2d;">project application form</a>.</p>
      </div>`;
  } else if (newStatus === "in_review") {
    nextStepsHtml = `
      <div style="background:#ebf8ff;border-radius:8px;margin-top:20px;padding:16px 20px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#2a4365;">What Happens Next</p>
        <p style="margin:6px 0 0;font-size:14px;color:#3a5a6a;">Our team is reviewing your submission. This typically takes 5–10 business days. We'll email you once a decision is made. No action is needed from you right now.</p>
      </div>`;
  }

  const reviewerNotesBlock = request.reviewerNotes
    ? `<div style="margin-top:20px;">
        <p style="margin:0 0 6px;font-size:13px;color:#8aaa8a;text-transform:uppercase;letter-spacing:.05em;">Reviewer Notes</p>
        <p style="margin:0;font-size:14px;color:#3a5a3a;line-height:1.6;background:#f8faf8;padding:12px 16px;border-radius:8px;">${escHtml(request.reviewerNotes)}</p>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f0;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f0;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="background:${statusColor};padding:24px 32px;">
          <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">🌱 Verification Status Update</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 4px;font-size:13px;color:#8aaa8a;text-transform:uppercase;letter-spacing:.05em;">Stellar GreenPay</p>
          <h1 style="margin:0 0 8px;font-size:22px;color:#1a3a1a;">${escHtml(request.projectName)}</h1>
          <p style="margin:0;font-size:18px;font-weight:600;color:${statusColor};">${statusLabel}</p>
          ${reviewerNotesBlock}
          ${nextStepsHtml}
          <a href="${adminUrl}" style="display:inline-block;margin-top:24px;background:#2d6a2d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View in Admin →</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildStatusChangeText({ request, newStatus, adminUrl }) {
  const statusLabel = { approved: "Approved ✅", rejected: "Not Approved", in_review: "Under Review 🔍" }[newStatus] || newStatus;

  let nextSteps = "";
  if (newStatus === "approved") {
    nextSteps = [
      "",
      "Next Steps:",
      "Your project has been approved! To complete on-chain registration,",
      `use the admin register endpoint: POST ${APP_URL}/api/projects/admin/register`,
      `See API docs: ${APP_URL}/api-docs`,
    ].join("\n");
  } else if (newStatus === "rejected") {
    nextSteps = [
      "",
      "Next Steps:",
      "Your submission was not approved at this time. You may address",
      "the reviewer notes and re-submit via the application form:",
      `${APP_URL}/apply`,
    ].join("\n");
  } else if (newStatus === "in_review") {
    nextSteps = [
      "",
      "What Happens Next:",
      "Our team is reviewing your submission. This typically takes 5–10",
      "business days. We'll email you once a decision is made.",
    ].join("\n");
  }

  return [
    `Verification Status Update — ${request.projectName}`,
    "",
    `Organisation: ${request.organizationName}`,
    `Project:      ${request.projectName}`,
    `New Status:   ${statusLabel}`,
    "",
    request.reviewerNotes ? `Reviewer Notes:\n${request.reviewerNotes}\n` : "",
    nextSteps,
    "",
    `View in admin: ${adminUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = { sendUpdateNotifications, sendAdminVerificationNotification, sendVerificationStatusNotification };
