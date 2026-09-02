/**
 * src/server.js — Stellar GreenPay API
 */
"use strict";

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const http = require("http");
const { Server } = require("socket.io");
const { initSentry, errorHandler: sentryErrorMiddleware } = require("./services/sentry");
const { runMigrations } = require("./db/migrate");
const { startTurretsServer } = require("./services/turrets");
const { start: startSummaryQueue } = require("./services/summaryQueue");
const { start: startProfileQueue } = require("./services/profileQueue");
const { start: startStatsRefreshQueue } = require("./services/statsRefreshQueue");
const { startIndexer } = require("./services/indexerService");
const logger = require("./logger");
const requestLogger = require("./middleware/requestLogger");
const { createCorsMiddleware, getAllowedOrigins } = require("./middleware/corsPolicy");
const { createRateLimiter } = require("./middleware/rateLimiter");
const projectsRouter = require("./routes/projects");
const donationsRouter = require("./routes/donations");
const leaderboardRouter = require("./routes/leaderboard");
const profilesRouter = require("./routes/profiles");
const statsRouter = require("./routes/stats");
const updatesRouter = require("./routes/updates");
const uploadsRouter = require("./routes/uploads");
const healthRouter = require("./routes/health");
const readinessRouter = require("./routes/readiness");
const notificationsRouter = require("./routes/notifications");
const adminRouter = require("./routes/admin");
const verificationRouter = require("./routes/verification");
const impactRouter = require("./routes/impact");
const subscriptionsRouter = require("./routes/subscriptions");
const ratingsRouter = require("./routes/ratings");
const jobsRouter = require("./routes/jobs");
const webhooksRouter = require("./routes/webhooks");

const app = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Sentry initialization (must be added before other middleware)
initSentry(app);

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

app.use(helmet());
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
});
app.use(requestLogger);
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/",
  },
  ignoreMethods: ["GET", "HEAD", "OPTIONS"],
});
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/notifications") ||
    req.path.startsWith("/api/v1/notifications") ||
    req.path === "/health" ||
    req.path === "/api/health" ||
    req.path === "/api/v1/health"
  ) {
    return next();
  }
  return csrfProtection(req, res, next);
});

const healthRouter = require("./routes/health");
app.use("/health", healthRouter);
app.use("/api/health", healthRouter);
app.use("/api/v1/health", healthRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1/uploads", uploadsRouter);

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
app.use(createRateLimiter(150, 15, "global"));

// ── CSRF token endpoint ────────────────────────────────────────────
function csrfTokenHandler(req, res) {
  res.json({ success: true, csrfToken: req.csrfToken() });
}
app.get("/api/csrf-token", csrfTokenHandler);
app.get("/api/v1/csrf-token", csrfTokenHandler);

app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
// Sentry error handler — capture exceptions before the final error middleware
app.use(sentryErrorMiddleware());

app.use((err, req, res, next) => {
  void next;
  console.error("[Error]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
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

  startIndexer(io).catch(err => logger.error({ event: "indexer_startup_error", err }, err.message));

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
