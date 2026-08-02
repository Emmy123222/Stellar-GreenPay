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
const { start: startRecurringDonationQueue } = require("./services/recurringDonationQueue");
const { startIndexer } = require("./services/indexerService");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const requestLogger = require("pino-http")({ logger });
const { createCorsMiddleware, getAllowedOrigins } = require("./middleware/corsPolicy");
const requestLogger = require("./middleware/requestLogger");
const { createRateLimiter } = require("./middleware/rateLimiter");
const logger = require("./logger");

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
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  })
);
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
  if (req.path.startsWith("/api/notifications") || req.path.startsWith("/api/v1/notifications")) {
    return next();
  }
  return csrfProtection(req, res, next);
});

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
app.use(createRateLimiter(150, 15));

// ── CSRF token endpoint ────────────────────────────────────────────
function csrfTokenHandler(req, res) {
  res.json({ success: true, csrfToken: req.csrfToken() });
}
app.get("/api/csrf-token", csrfTokenHandler);
app.get("/api/v1/csrf-token", csrfTokenHandler);

// ── Health / readiness (unversioned + versioned) ────────────────────
const healthRouter = require("./routes/health");
const readinessRouter = require("./routes/readiness");
app.use("/health", healthRouter);
app.use("/api/health", healthRouter);
app.use("/api/v1/health", healthRouter);
app.use("/ready", readinessRouter);
app.use("/api/ready", readinessRouter);
app.use("/api/v1/ready", readinessRouter);

// ── API routes (legacy /api + versioned /api/v1) ────────────────────
function mountApi(resourcePath, router) {
  app.use(`/api${resourcePath}`, router);
  app.use(`/api/v1${resourcePath}`, router);
}

mountApi("/projects", require("./routes/projects"));
mountApi("/donations", require("./routes/donations"));
mountApi("/profiles", require("./routes/profiles"));
mountApi("/leaderboard", require("./routes/leaderboard"));
mountApi("/updates", require("./routes/updates"));
mountApi("/subscriptions", require("./routes/subscriptions"));
mountApi("/jobs", require("./routes/jobs"));
mountApi("/stats", require("./routes/stats"));
mountApi("/impact", require("./routes/impact"));
mountApi("/ratings", require("./routes/ratings"));
mountApi("/admin", require("./routes/admin"));
mountApi("/notifications", require("./routes/notifications"));
mountApi("/uploads", require("./routes/uploads"));
mountApi("/verification-requests", require("./routes/verification"));
mountApi("/recurring-donations", require("./routes/recurringDonations"));

app.use("/api/webhooks", require("./routes/webhooks"));

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
  await startRecurringDonationQueue();

  startIndexer(io).catch((err) => logger.error({ event: "indexer_startup_error", err }, err.message));

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
