/**
 * src/server.js — Stellar GreenPay API
 */
"use strict";

const express   = require("express");
const cookieParser = require("cookie-parser");
const csurf     = require("csurf");
const helmet    = require("helmet");
const morgan    = require("morgan");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const { runMigrations } = require("./db/migrate");
const { startTurretsServer } = require("./services/turrets");
const http = require("http");
const { Server } = require("socket.io");
const { startIndexer } = require("./services/indexerService");
const { createCorsMiddleware, getAllowedOrigins } = require("./middleware/corsPolicy");

const app  = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// ── Swagger UI (development) ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  const swaggerUi = require("swagger-ui-express");
  const yaml = require("js-yaml");
  const fs = require("fs");
  const path = require("path");
  const swaggerDoc = yaml.load(fs.readFileSync(path.join(__dirname, "../../docs/openapi.yml"), "utf8"));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));
}

app.use(helmet());
app.use(morgan("dev"));
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

app.use("/health",        require("./routes/health"));
app.use("/api/projects",  require("./routes/projects"));
app.use("/api/donations", require("./routes/donations"));
app.use("/api/profiles",  require("./routes/profiles"));
app.use("/api/leaderboard", require("./routes/leaderboard"));
app.use("/api/updates",        require("./routes/updates"));
app.use("/api/subscriptions",  require("./routes/subscriptions"));
app.use("/api/jobs",           require("./routes/jobs"));
app.use("/api/stats",          require("./routes/stats"));
app.use("/api/impact",         require("./routes/impact"));
app.use("/api/ratings",        require("./routes/ratings"));
app.use("/api/admin",          require("./routes/admin"));

app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  void next;
  console.error("[Error]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

async function startServer() {
  await runMigrations();
  
  // Start the indexer service
  startIndexer(io).catch(err => console.error("[Indexer Error]", err.message));

  // Start the main API server
  server.listen(PORT, () => {
    console.log(`\n  🌱 Stellar GreenPay API\n  🚀 Running at http://localhost:${PORT}\n  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}\n`);
  });

  // Start the Turrets server for donation matching (if enabled)
  if (process.env.ENABLE_TURRETS === "true") {
    const turretsPort = process.env.TURRETS_PORT || 3001;
    startTurretsServer(turretsPort);
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("[Startup Error]", err.message);
    process.exit(1);
  });
}

module.exports = app;
