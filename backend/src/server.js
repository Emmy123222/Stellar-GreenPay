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
const indexerService = require("./services/indexerService");
const { isStellarTimeoutError } = require("./services/stellar");
const { createCorsMiddleware, getAllowedOrigins } = require("./middleware/corsPolicy");
const { createRateLimiter } = require("./middleware/rateLimiter");
const { metricsHandler, countRequest, startQueueRefresh } = require("./services/metrics");
const { createSelectiveCsrf } = require("./middleware/selectiveCsrf");

const projectsRouter = require("./routes/projects");
const uploadsRouter = require("./routes/uploads");
const donationsRouter = require("./routes/donations");
const statsRouter = require("./routes/stats");
const adminRouter = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Sentry initialization (must be added before other middleware)
initSentry();

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
    console.warn("[swagger] docs unavailable:", err.message);
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

const origins = getAllowedOrigins();
app.use(...createCorsMiddleware(origins));

const healthRouter = require("./routes/health");
const readinessRouter = require("./routes/readiness");
app.get("/metrics", metricsHandler);
app.get("/api/metrics", metricsHandler);
app.use("/health", healthRouter);
app.use("/api/health", healthRouter);
app.use("/api/v1/health", healthRouter);
app.use("/api/readiness", readinessRouter);
app.get("/api/indexer/health", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const health = await indexerService.getHealth();
    res.status(health.status === "ok" ? 200 : 503).json({
      service: "stellar-greenpay-indexer",
      ...health,
    });
  } catch (error) {
    logger.warn(
      { event: "indexer_health_probe_failed", errorName: error instanceof Error ? error.name : "UnknownError" },
      "Indexer health probe failed",
    );
    res.status(503).json({
      service: "stellar-greenpay-indexer",
      status: "unavailable",
      timestamp: new Date().toISOString(),
      isRunning: false,
      currentLedger: null,
      lastProcessedLedger: null,
      lastProcessedAt: null,
      lagLedgers: null,
    });
  }
});
app.use("/api/projects", projectsRouter);
app.use("/api/v1/projects", projectsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/v1/uploads", uploadsRouter);
app.use("/api/donations", donationsRouter);
app.use("/api/v1/donations", donationsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/v1/stats", statsRouter);

const io = new Server(server, {
  cors: {
    origin: origins,
    methods: ["GET", "POST"],
    credentials: false,
  },
});
app.set("io", io);

const { registerSocketHandlers } = require("./services/socketHandler");
registerSocketHandlers(io);

app.use(createRateLimiter(150, 15, "global"));

// ── CSRF token endpoint ────────────────────────────────────────────
function csrfTokenHandler(req, res) {
  res.json({ success: true, csrfToken: req.csrfToken() });
}
app.get("/api/csrf-token", csrfTokenHandler);
app.get("/api/v1/csrf-token", csrfTokenHandler);

app.use("/api/impact", require("./routes/impact"));
app.use("/api/v1/impact", require("./routes/impact"));
app.use("/api/subscriptions", require("./routes/subscriptions"));
app.use("/api/v1/subscriptions", require("./routes/subscriptions"));
app.use("/api/referrals", require("./routes/referrals"));
app.use("/api/v1/referrals", require("./routes/referrals"));
// Recurring donation schedules are the source of truth for mobile (#1059):
// the app reads them from here and treats AsyncStorage as an offline cache.
app.use("/api/recurring-donations", require("./routes/recurringDonations"));
app.use("/api/v1/recurring-donations", require("./routes/recurringDonations"));
// Wallet-signature authentication (challenge → signed tx → JWT).
app.use("/api/auth", require("./routes/auth"));
app.use("/api/v1/auth", require("./routes/auth"));
// Project ratings (donor-submitted, wallet-authenticated).
app.use("/api/ratings", require("./routes/ratings"));
app.use("/api/v1/ratings", require("./routes/ratings"));
// Team giving (corporate/group donation profiles).
app.use("/api/teams", require("./routes/teams"));
app.use("/api/v1/teams", require("./routes/teams"));
// Price oracle endpoints (rates in USD, EUR, BRL)
app.use("/api/price", require("./routes/price"));
app.use("/api/v1/price", require("./routes/price"));
// Admin dashboard, audit log and moderation endpoints (dual-prefix like projects/donations).
app.use("/api/admin", adminRouter);
app.use("/api/v1/admin", adminRouter);
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

  indexerService.startIndexer(io).catch(err => logger.error({ event: "indexer_startup_error", err }, err.message));

  startQueueRefresh();

  server.listen(PORT, () => {
    logger.info({ event: "server_start", port: PORT }, `API listening on port ${PORT}`);
  });

  if (process.env.ENABLE_TURRETS === "true") {
    const turretsPort = process.env.TURRETS_PORT || 3001;
    startTurretsServer(turretsPort);
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.fatal({ event: "startup_error", err }, err.message);
    process.exit(1);
  });
}

module.exports = app;
