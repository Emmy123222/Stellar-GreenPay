/**
 * src/server.js — Stellar GreenPay API
 */
"use strict";

const express   = require("express");
const cors      = require("cors");
const helmet    = require("helmet");
const morgan    = require("morgan");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const { runMigrations } = require("./db/migrate");
const { startTurretsServer } = require("./services/turrets");
const http = require("http");
const { Server } = require("socket.io");
const { startIndexer } = require("./services/indexerService");

const app  = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "20kb" }));

const origins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => (!origin || origins.includes(origin)) ? cb(null, true) : cb(new Error("CORS blocked")),
  methods: ["GET", "POST", "PATCH"],
}));

const io = new Server(server, {
  cors: {
    origin: origins,
    methods: ["GET", "POST"]
  }
});
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

app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
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

startServer().catch((err) => {
  console.error("[Startup Error]", err.message);
  process.exit(1);
});

module.exports = app;
