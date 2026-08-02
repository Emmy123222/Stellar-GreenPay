"use strict";

const Sentry = require("@sentry/node");

function initSentry(app) {
  if (!process.env.SENTRY_DSN) return Sentry;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
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

  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());

  return Sentry;
}

function errorHandler() {
  return Sentry.Handlers.errorHandler();
}

module.exports = { initSentry, errorHandler, Sentry };
