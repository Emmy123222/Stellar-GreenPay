"use strict";
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function getSecret() {
  return process.env.JWT_SECRET || "dev-secret-do-not-use-in-prod";
}

function signToken(payload, expiresIn) {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

function signAdminToken(payload) {
  // Admin tokens have a very short TTL (15 minutes) for sensitive operations
  return jwt.sign(payload, getSecret(), { expiresIn: "15m" });
}

function verifyAdminToken(token) {
  const decoded = jwt.verify(token, getSecret());
  
  // Verify the token has admin role claim
  if (decoded.role !== "admin") {
    throw new Error("Admin role required");
  }
  
  // Verify the token is an admin token (not a regular user token)
  if (decoded.type !== "admin") {
    throw new Error("Admin token type required");
  }
  
  return decoded;
}

function getConfiguredAdminKeys() {
  return [
    process.env.ADMIN_API_KEY,
    ...(process.env.ADMIN_API_KEYS || "").split(","),
  ]
    .map((key) => (typeof key === "string" ? key.trim() : ""))
    .filter(Boolean);
}

function timingSafeEquals(a, b) {
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

function isValidAdminKey(value) {
  if (!value || typeof value !== "string") return false;
  return getConfiguredAdminKeys().some((configuredKey) =>
    timingSafeEquals(value, configuredKey),
  );
}

function attachAdminKeyPrincipal(req) {
  req.admin = {
    role: "admin",
    sub: "admin-key",
    authMethod: "x-admin-key",
  };
}

function adminKeyRequired(req, res, next) {
  const configuredKeys = getConfiguredAdminKeys();
  const adminKey = req.get("X-Admin-Key");

  if (!adminKey) {
    return res.status(401).json({ error: "Missing X-Admin-Key header" });
  }

  if (configuredKeys.length === 0) {
    return res.status(503).json({ error: "Admin key authentication not configured on this server" });
  }

  if (!isValidAdminKey(adminKey)) {
    return res.status(401).json({ error: "Invalid X-Admin-Key header" });
  }

  attachAdminKeyPrincipal(req);
  next();
}

function adminRequired(req, res, next) {
  const adminKey = req.get("X-Admin-Key");
  if (adminKey && isValidAdminKey(adminKey)) {
    attachAdminKeyPrincipal(req);
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = verifyToken(token);
    
    // Verify the token has admin role claim
    if (decoded.role !== "admin") {
      return res.status(403).json({ error: "Insufficient permissions: admin role required" });
    }
    
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminTokenRequired(req, res, next) {
  const adminKey = req.get("X-Admin-Key");
  if (adminKey && isValidAdminKey(adminKey)) {
    attachAdminKeyPrincipal(req);
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = verifyAdminToken(token);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Admin token expired" });
    }
    return res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

const pool = require("../db/pool");

async function validateAdminAddress(req, res, next) {
  const projectId = req.params.id;
  const adminAddress = req.headers["x-admin-address"];

  if (!adminAddress) {
    return res.status(401).json({ error: "Missing X-Admin-Address header" });
  }

  try {
    const result = await pool.query("SELECT wallet_address FROM projects WHERE id = $1", [projectId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectOwnerAddress = result.rows[0].wallet_address;
    if (adminAddress !== projectOwnerAddress) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { signToken, verifyToken, signAdminToken, verifyAdminToken, adminRequired, adminTokenRequired, adminKeyRequired, isValidAdminKey, validateAdminAddress };