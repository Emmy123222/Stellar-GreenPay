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

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "20kb" }));

const origins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => (!origin || origins.includes(origin)) ? cb(null, true) : cb(new Error("CORS blocked")),
  methods: ["GET", "POST"],
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: false }));

app.use("/health",        require("./routes/health"));
app.use("/api/projects",  require("./routes/projects"));
app.use("/api/donations", require("./routes/donations"));
app.use("/api/profiles",  require("./routes/profiles"));
app.use("/api/leaderboard", require("./routes/leaderboard"));
app.use("/api/updates",   require("./routes/updates"));

app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  console.error("[Error]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

async function startServer() {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`\n  🌱 Stellar GreenPay API\n  🚀 Running at http://localhost:${PORT}\n  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}\n`);
  });
}

startServer().catch((err) => {
  console.error("[Startup Error]", err.message);
  process.exit(1);
});

module.exports = app;
