"use strict";

const Sentry = require("@sentry/node");

function initSentry() {
  if (!process.env.SENTRY_DSN) return Sentry;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Keep performance traces bounded in production while retaining every error event.
    tracesSampleRate: 0.05,
    sampleRate: 1.0,
    environment: process.env.NODE_ENV,
  });

  process.on("uncaughtException", (err) => {
    Sentry.captureException(err);
    console.error("[Uncaught Exception]", err.message);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason);
    console.error("[Unhandled Rejection]", reason);
  });

  return Sentry;
}

function errorHandler() {
  if (Sentry.Handlers?.errorHandler) {
    return Sentry.Handlers.errorHandler();
  }
  if (typeof Sentry.expressErrorHandler === "function") {
    return Sentry.expressErrorHandler();
  }
  return (err, _req, _res, next) => next(err);
}

module.exports = { initSentry, errorHandler, Sentry };
