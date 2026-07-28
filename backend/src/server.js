/**
 * src/server.js — Stellar GreenPay API
 */
"use strict";

require("dotenv").config();
const Sentry = require("@sentry/node");
require("@sentry/tracing");

Sentry.init({
  dsn: process.env.SENTRY_DSN || "",
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});

const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const rateLimit = require("express-rate-limit");
const http = require("http");
const { Server } = require("socket.io");

const logger = require("./logger");
const requestLogger = require("./middleware/requestLogger");
const { runMigrations } = require("./db/migrate");
const { startTurretsServer } = require("./services/turrets");
const { start: startSummaryQueue } = require("./services/summaryQueue");
const { start: startProfileQueue } = require("./services/profileQueue");
const { startIndexer } = require("./services/indexerService");
const { createCorsMiddleware, getAllowedOrigins } = require("./middleware/corsPolicy");

const app = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Sentry request/tracing handlers (must be added before other middleware)
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// ── Swagger UI (development) ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  const swaggerUi = require("swagger-ui-express");
  const yaml = require("js-yaml");
  const fs = require("fs");
  const path = require("path");
  const swaggerPath = path.join(__dirname, "../../docs/api/openapi.yaml");
  const swaggerDoc = yaml.load(fs.readFileSync(swaggerPath, "utf8"));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));
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
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: false }));

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

app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
// Sentry error handler — capture and send exceptions to Sentry
app.use(Sentry.Handlers.errorHandler());

app.use((err, req, res, next) => {
  void next;
  try {
    Sentry.captureException(err);
  } catch (e) {
    // ignore
  }
  console.error("[Error]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

async function startServer() {
  await runMigrations();

  await startSummaryQueue(io);
  await startProfileQueue(io);

  const { start: startDigestQueue } = require("./services/digestQueue");
  await startDigestQueue();

  startIndexer(io).catch((err) => logger.error({ event: "indexer_startup_error", err }, err.message));

  server.listen(PORT, () => {
    console.log(`Stellar GreenPay API listening on :${PORT}`);
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
