"use strict";

const Sentry = require("@sentry/node");
const logger = require("../logger");

function initSentry(app) {
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
    logger.fatal({ event: "uncaught_exception", err }, `[Uncaught Exception] ${err.message}`);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason);
    logger.error({ event: "unhandled_rejection", reason }, "[Unhandled Rejection]");
  });

  if (Sentry.Handlers?.requestHandler) app.use(Sentry.Handlers.requestHandler());
  if (Sentry.Handlers?.tracingHandler) app.use(Sentry.Handlers.tracingHandler());

  return Sentry;
}

function errorHandler() {
  if (Sentry.Handlers?.errorHandler) {
    return Sentry.Handlers.errorHandler();
  }
  return (err, req, res, next) => next(err);
}

module.exports = { initSentry, errorHandler, Sentry };
