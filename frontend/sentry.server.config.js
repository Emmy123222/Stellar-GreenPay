const Sentry = require("@sentry/nextjs");

Sentry.init({
  dsn: process.env.SENTRY_DSN || "",
  tracesSampleRate: 0.05,
  sampleRate: 1.0,
  environment: process.env.NODE_ENV,
});
