/**
 * src/server.js — Stellar GreenPay API
 */
"use strict";

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const http = require("http");
const logger = require("./logger");
const requestLogger = require("./middleware/requestLogger");
const { Server } = require("socket.io");
const { initSentry, errorHandler: sentryErrorMiddleware } = require("./services/sentry");
const { runMigrations } = require("./db/migrate");
const { startTurretsServer } = require("./services/turrets");
const { start: startSummaryQueue } = require("./services/summaryQueue");
const { start: startProfileQueue } = require("./services/profileQueue");
const { start: startStatsRefreshQueue } = require("./services/statsRefreshQueue");
const { startIndexer } = require("./services/indexerService");
const { isStellarTimeoutError } = require("./services/stellar");
const { createCorsMiddleware, getAllowedOrigins } = require("./middleware/corsPolicy");
const { createRateLimiter } = require("./middleware/rateLimiter");
const { metricsHandler, countRequest, startQueueRefresh } = require("./services/metrics");
const { createSelectiveCsrf } = require("./middleware/selectiveCsrf");
const { registerSocketHandlers } = require("./services/socketHandler");

const healthRouter = require("./routes/health");
const readinessRouter = require("./routes/readiness");
const projectPreferredAssetRouter = require("./routes/projectPreferredAsset");
const projectsRouter = require("./routes/projects");
const uploadsRouter = require("./routes/uploads");
const donationsRouter = require("./routes/donations");
const statsRouter = require("./routes/stats");
const jobsRouter = require("./routes/jobs");
const adminRouter = require("./routes/admin");
const certificateRouter = require("./routes/certificate");
const notificationsRouter = require("./routes/notifications");
const impactRouter = require("./routes/impact");
const subscriptionsRouter = require("./routes/subscriptions");
const referralsRouter = require("./routes/referrals");
const recurringDonationsRouter = require("./routes/recurringDonations");
const authRouter = require("./routes/auth");
const ratingsRouter = require("./routes/ratings");
const commentsRouter = require("./routes/comments");
const updatesRouter = require("./routes/updates");
const teamsRouter = require("./routes/teams");
const priceRouter = require("./routes/price");
const webhooksRouter = require("./routes/webhooks");
const extensionRouter = require("./routes/extension");
const mobileRouter = require("./routes/mobile");
const profilesRouter = require("./routes/profiles");
const leaderboardRouter = require("./routes/leaderboard");
const verificationRouter = require("./routes/verification");

const app = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Sentry initialization (must be added before other middleware)
initSentry(app);

// ── Security & CSP (Helmet) ──────────────────────────────────────────────────
const apiHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
});

const docsHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    },
  },
});

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production" && req.path.startsWith("/api/docs")) {
    return docsHelmet(req, res, next);
  }
  return apiHelmet(req, res, next);
});

// ── Swagger UI (development) ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  try {
    const swaggerUi = require("swagger-ui-express");
    const yaml = require("js-yaml");
    const fs = require("fs");
    const path = require("path");
    const swaggerPath = path.join(__dirname, "../../docs/api/openapi.yaml");
    const swaggerDoc = yaml.load(fs.readFileSync(swaggerPath, "utf8"));
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));
  } catch (err) {
    // Missing js-yaml/openapi must not crash require("../server") during tests
    logger.warn({ event: "swagger_docs_unavailable", err: err.message }, `[swagger] docs unavailable: ${err.message}`);
  }
}

app.use((req, res, next) => {
  const originalEnd = res.end.bind(res);
  res.end = function promCountEnd(chunk, encoding, cb) {
    if (!res.__metricsCounted) {
      res.__metricsCounted = true;
      countRequest(req, res);
    }
    return originalEnd(chunk, encoding, cb);
  };
  next();
});

app.use(requestLogger);
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());

app.use(createSelectiveCsrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/",
  },
  ignoreMethods: ["GET", "HEAD", "OPTIONS"],
}));

app.get("/metrics", metricsHandler);
app.get("/api/metrics", metricsHandler);
app.use("/health", healthRouter);
app.use("/api/health", healthRouter);
app.use("/api/v1/health", healthRouter);
app.use("/api/readiness", readinessRouter);
// Preferred receive asset for DEX path-payment donations (#1660). Mounted
// before the projects router so its sub-path is matched here.
app.use("/api/projects/:id/preferred-asset", projectPreferredAssetRouter);
app.use("/api/v1/projects/:id/preferred-asset", projectPreferredAssetRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/v1/projects", projectsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/v1/uploads", uploadsRouter);
app.use("/api/donations", donationsRouter);
app.use("/api/v1/donations", donationsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/v1/jobs", jobsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/v1/stats", statsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);

const origins = getAllowedOrigins();
app.use(...createCorsMiddleware(origins));

const io = new Server(server, {
  cors: {
    origin: origins,
    methods: ["GET", "POST"],
    credentials: false,
  },
});
app.set("io", io);

registerSocketHandlers(io);

app.use(createRateLimiter(150, 15, "global"));

// ── CSRF token endpoint ────────────────────────────────────────────
function csrfTokenHandler(req, res) {
  res.json({ success: true, csrfToken: req.csrfToken() });
}
app.get("/api/csrf-token", csrfTokenHandler);
app.get("/api/v1/csrf-token", csrfTokenHandler);

// Donation impact certificates (#1523). Mounted on the certificate sub-prefix
// ahead of the impact router; it only owns /donation/:id, so the impact
// router's public /certificate/:slug share endpoint keeps single-segment paths.
app.use("/api/impact/certificate", certificateRouter);
app.use("/api/v1/impact/certificate", certificateRouter);
app.use("/api/impact", impactRouter);
app.use("/api/v1/impact", impactRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/v1/subscriptions", subscriptionsRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/v1/referrals", referralsRouter);
// Recurring donation schedules are the source of truth for mobile (#1059):
// the app reads them from here and treats AsyncStorage as an offline cache.
app.use("/api/recurring-donations", recurringDonationsRouter);
app.use("/api/v1/recurring-donations", recurringDonationsRouter);
// Wallet-signature authentication (challenge → signed tx → JWT).
app.use("/api/auth", authRouter);
app.use("/api/v1/auth", authRouter);
// Project ratings (donor-submitted, wallet-authenticated).
app.use("/api/ratings", ratingsRouter);
app.use("/api/v1/ratings", ratingsRouter);
// Donor comments on project pages (wallet-authenticated, moderated, rate limited).
app.use("/api/comments", commentsRouter);
app.use("/api/v1/comments", commentsRouter);

app.use("/api/updates", updatesRouter);
app.use("/api/v1/updates", updatesRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/v1/profiles", profilesRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
// Team giving (corporate/group donation profiles).
app.use("/api/teams", teamsRouter);
app.use("/api/v1/teams", teamsRouter);
// Price oracle endpoints (rates in USD, EUR, BRL)
app.use("/api/price", priceRouter);
app.use("/api/v1/price", priceRouter);
// Companion extension & mobile client routers (CSRF-exempt)
app.use("/api/extension", extensionRouter);
app.use("/api/v1/extension", extensionRouter);
app.use("/api/mobile", mobileRouter);
app.use("/api/v1/mobile", mobileRouter);
// Admin dashboard, audit log and moderation endpoints (dual-prefix like projects/donations).
app.use("/api/admin", adminRouter);
app.use("/api/v1/admin", adminRouter);
// Webhook subscription management, delivery history and test sends (dual-prefix like projects/donations).
app.use("/api/webhooks", webhooksRouter);
app.use("/api/v1/webhooks", webhooksRouter);
// Project verification requests (dual-prefix like projects/donations).
app.use("/api/verification", verificationRouter);
app.use("/api/v1/verification", verificationRouter);
app.use("/api/verification-requests", verificationRouter);
app.use("/api/v1/verification-requests", verificationRouter);
app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
// Sentry error handler — capture exceptions before the final error middleware
app.use(sentryErrorMiddleware());

app.use((err, req, res, next) => {
  void next;
  const isTimeout = isStellarTimeoutError(err);
  const status = isTimeout ? 503 : err.status || 500;
  logger.error({ err, event: "request_error", path: req.path, status }, err.message);
  if (!res.__metricsCounted) {
    res.__metricsCounted = true;
    countRequest(req, { ...res, statusCode: status });
  }
  if (isTimeout) {
    return res.status(status).json({ error: "Stellar network did not respond in time, please retry" });
  }
  res.status(status).json({ error: err.message || "Internal server error" });
});

async function startServer() {
  await runMigrations();

  await startSummaryQueue(io);
  await startProfileQueue(io);

  const { start: startDigestQueue } = require("./services/digestQueue");
  await startDigestQueue();
  await startStatsRefreshQueue();

  const { start: startWebhookQueue } = require("./services/webhook");
  await startWebhookQueue();

  const { start: startRecurringDonationQueue } = require("./services/recurringDonationQueue");
  await startRecurringDonationQueue();

  const { start: startTokenCleanupQueue } = require("./services/tokenCleanupQueue");
  await startTokenCleanupQueue();

  const { start: startDonationPushQueue } = require("./services/donationPushQueue");
  await startDonationPushQueue();

  startIndexer(io).catch(err => logger.error({ event: "indexer_startup_error", err }, err.message));

  startQueueRefresh();

  server.listen(PORT, () => {
    logger.info({ event: "server_start", port: PORT }, `API listening on port ${PORT}`);
  });

  if (process.env.ENABLE_TURRETS === "true") {
    const turretsPort = process.env.TURRETS_PORT || 3001;
    // startTurretsServer returns { app, server } so the listener is closeable
    // (tests and graceful shutdown). Keep the reference for future wiring.
    const { server: turretsServer } = startTurretsServer(turretsPort);
    void turretsServer;
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.fatal({ event: "startup_error", err }, err.message);
    process.exit(1);
  });
}

module.exports = app;