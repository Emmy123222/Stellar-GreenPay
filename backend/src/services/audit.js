"use strict";

const { v4: uuid } = require("uuid");
const pool = require("../db/pool");

async function logAdminAction({ actor, action, targetType, targetId, metadata, ipAddress }) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (id, actor, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), actor, action, targetType || null, targetId || null, JSON.stringify(metadata || {}), ipAddress || null],
    );
  } catch (err) {
    console.error("[AuditLog] Failed to record action:", err.message);
  }
}

function auditMiddleware(action, targetType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400) {
        const actor = req.body?.adminAddress || req.body?.actor || req.ip || "unknown";
        const targetId = req.params?.id || req.body?.projectId || null;
        logAdminAction({
          actor,
          action,
          targetType,
          targetId,
          metadata: {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            body: sanitizeMetadata(req.body),
          },
          ipAddress: req.ip,
        });
      }
      return originalJson(body);
    };
    next();
  };
}

function sanitizeMetadata(body) {
  if (!body) return {};
  const sanitized = { ...body };
  delete sanitized.adminAddress;
  delete sanitized.secretKey;
  delete sanitized.secret;
  return sanitized;
}

module.exports = { logAdminAction, auditMiddleware };
