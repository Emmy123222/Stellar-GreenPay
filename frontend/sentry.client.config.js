const Sentry = require("@sentry/nextjs");

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || "",
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});
