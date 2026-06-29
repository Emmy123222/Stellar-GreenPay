/**
 * src/server.js — Stellar GreenPay API
 */
"use strict";

require("dotenv").config();

if (process.env.NODE_ENV !== "test") {
  const { validateEnv } = require("./config/env");
  validateEnv();
}

const express      = require("express");
const cookieParser = require("cookie-parser");
const csurf        = require("csurf");
const helmet       = require("helmet");
const rateLimit    = require("express-rate-limit");
const logger       = require("./logger");
const requestLogger = require("./middleware/requestLogger");
const { runMigrations } = require("./db/migrate");
const { startTurretsServer } = require("./services/turrets");
const http = require("http");
const { Server } = require("socket.io");
const { startIndexer } = require("./services/indexerService");
const { createCorsMiddleware, getAllowedOrigins } = require("./middleware/corsPolicy");

const app    = express();
const PORT   = process.env.PORT || 4000;
const server = http.createServer(app);

// ── Swagger UI (development) ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  const swaggerUi = require("swagger-ui-express");
  const yaml      = require("js-yaml");
  const fs        = require("fs");
  const path      = require("path");
  const swaggerDoc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/openapi.yml"), "utf8"));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));
}

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use(csurf({
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

const io = new Server(server, {
  cors: {
    origin: origins,
    methods: ["GET", "POST"],
    credentials: false,
  }
});
app.set("io", io);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: false }));

// ── CSRF token endpoint ──────────────────────────────────────────────────────
function csrfTokenHandler(req, res) {
  res.json({ success: true, csrfToken: req.csrfToken() });
}
app.get("/api/csrf-token", csrfTokenHandler);
app.get("/api/v1/csrf-token", csrfTokenHandler);

// ── Route mounts — each router registered at /api and /api/v1 ───────────────
const projectsRouter      = require("./routes/projects");
const donationsRouter     = require("./routes/donations");
const profilesRouter      = require("./routes/profiles");
const leaderboardRouter   = require("./routes/leaderboard");
const updatesRouter       = require("./routes/updates");
const subscriptionsRouter = require("./routes/subscriptions");
const jobsRouter          = require("./routes/jobs");
const statsRouter         = require("./routes/stats");
const impactRouter        = require("./routes/impact");
const ratingsRouter       = require("./routes/ratings");
const adminRouter         = require("./routes/admin");

function mount(path, router) {
  app.use(path, router);
  app.use("/api/v1" + path.replace(/^\/api/, ""), router);
}

app.use("/health", require("./routes/health"));
mount("/api/projects",      projectsRouter);
mount("/api/donations",     donationsRouter);
mount("/api/profiles",      profilesRouter);
mount("/api/leaderboard",   leaderboardRouter);
mount("/api/updates",       updatesRouter);
mount("/api/subscriptions", subscriptionsRouter);
mount("/api/jobs",          jobsRouter);
mount("/api/stats",         statsRouter);
mount("/api/impact",        impactRouter);
mount("/api/ratings",       ratingsRouter);
mount("/api/admin",         adminRouter);

app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ event: "unhandled_error", err }, err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

async function startServer() {
  await runMigrations();

  const { start: startSummaryQueue } = require("./services/summaryQueue");
  await startSummaryQueue(io);

  startIndexer(io).catch(err => logger.error({ event: "indexer_startup_error", err }, err.message));

  server.listen(PORT, () => {
    logger.info({ event: "server_start", port: PORT, network: process.env.STELLAR_NETWORK || "testnet" }, "Stellar GreenPay API running");
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
