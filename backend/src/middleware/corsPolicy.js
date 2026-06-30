"use strict";

const cors = require("cors");

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://greenpay.app",
  "https://www.greenpay.app",
  "https://stellar-greenpay.app",
  "https://www.stellar-greenpay.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getAllowedOrigins(value = process.env.ALLOWED_ORIGINS) {
  const configuredOrigins = parseOrigins(value);
  const origins = configuredOrigins.length > 0
    ? configuredOrigins
    : DEFAULT_ALLOWED_ORIGINS;

  return [...new Set(origins)];
}

function rejectDisallowedOrigins(allowedOrigins = getAllowedOrigins()) {
  const allowed = new Set(allowedOrigins);

  return (req, res, next) => {
    const { origin } = req.headers;

    if (!origin || allowed.has(origin)) {
      return next();
    }

    return res.status(403).json({ error: "Origin not allowed" });
  };
}

function createCorsOptions(allowedOrigins = getAllowedOrigins()) {
  const allowed = new Set(allowedOrigins);

  return {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, false);
      }

      return callback(null, allowed.has(origin));
    },
    credentials: false,
    methods: ["GET", "POST", "PATCH"],
  };
}

function createCorsMiddleware(allowedOrigins = getAllowedOrigins()) {
  return [
    rejectDisallowedOrigins(allowedOrigins),
    cors(createCorsOptions(allowedOrigins)),
  ];
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  createCorsMiddleware,
  createCorsOptions,
  getAllowedOrigins,
  rejectDisallowedOrigins,
};
