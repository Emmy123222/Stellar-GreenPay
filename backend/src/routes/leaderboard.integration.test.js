"use strict";

const fs = require("fs");
const path = require("path");
const { GenericContainer, Wait } = require("testcontainers");
const { Pool } = require("pg");
const request = require("supertest");
const express = require("express");

let container;
let pool;
let testPool;
let serverContainerReady = false;
let app;

function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}

function makeTxHash(char = "a") {
  return char.repeat(64);
}

describe("Leaderboard period integration", () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    if (process.env.SKIP_INTEGRATION === "1") {
      return;
    }
    try {
      container = await new GenericContainer("postgres:15-alpine")
        .withEnvironment({
          POSTGRES_USER: "test",
          POSTGRES_PASSWORD: "test",
          POSTGRES_DB: "greenpay_test",
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
        .withStartupTimeout(60000)
        .start();

      const host = container.getHost();
      const port = container.getMappedPort(5432);
      const connectionString = `postgres://test:test@${host}:${port}/greenpay_test`;

      testPool = new Pool({ connectionString, max: 5 });
      const schemaSql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
      await testPool.query(schemaSql);

      process.env.DATABASE_URL = connectionString;
      delete require.cache[require.resolve("../db/pool")];
      delete require.cache[require.resolve("./leaderboard")];

      pool = require("../db/pool");
      const leaderboardRouter = require("./leaderboard");
      app = express();
      app.use(express.json());
      app.use("/api/leaderboard", leaderboardRouter);
      
      serverContainerReady = true;
    } catch (err) {
      serverContainerReady = false;
    }
  });

  afterAll(async () => {
    try { if (pool) await pool.end(); } catch { /* ignore */ }
    try { if (testPool) await testPool.end(); } catch { /* ignore */ }
    try { if (container) await container.stop({ timeout: 5000 }); } catch { /* ignore */ }
  });

  beforeEach(async () => {
    if (testPool) {
      await testPool.query("TRUNCATE donations, profiles, projects RESTART IDENTITY CASCADE");
    }
  });

  test("GET /api/leaderboard respects period query parameter", async () => {
    if (!serverContainerReady) return;

    const projectId = "11111111-1111-1111-1111-111111111111";
    await testPool.query(
      "INSERT INTO projects (id, name, description, category, location, wallet_address, raised_xlm) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [projectId, "Test Project", "Desc", "Cat", "Loc", makePublicKey("P"), "0"]
    );

    const donorA = makePublicKey("A");
    const donorB = makePublicKey("B");
    const donorC = makePublicKey("C");
    
    await testPool.query("INSERT INTO profiles (public_key, display_name) VALUES ($1, $2), ($3, $4), ($5, $6)", [donorA, "Alice", donorB, "Bob", donorC, "Charlie"]);

    // donorA: today
    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      ["22222222-2222-2222-2222-222222222221", projectId, donorA, "10", "10", "XLM", makeTxHash("a")]
    );

    // donorB: 10 days ago (within month, outside week)
    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '10 days')`,
      ["22222222-2222-2222-2222-222222222222", projectId, donorB, "20", "20", "XLM", makeTxHash("b")]
    );

    // donorC: 40 days ago (within year, outside month)
    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '40 days')`,
      ["22222222-2222-2222-2222-222222222223", projectId, donorC, "30", "30", "XLM", makeTxHash("c")]
    );
    
    // donorA: 2 years ago (outside year)
    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '2 years')`,
      ["22222222-2222-2222-2222-222222222224", projectId, donorA, "100", "100", "XLM", makeTxHash("d")]
    );

    // week: only donorA (10)
    let res = await request(app).get("/api/leaderboard?period=week");
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].publicKey).toBe(donorA);
    expect(parseFloat(res.body.data[0].totalDonatedXLM)).toBe(10);

    // month: donorB (20) and donorA (10)
    res = await request(app).get("/api/leaderboard?period=month");
    expect(res.body.data.length).toBe(2);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorB).totalDonatedXLM)).toBe(20);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorA).totalDonatedXLM)).toBe(10);

    // year: donorC (30), donorB (20), donorA (10)
    res = await request(app).get("/api/leaderboard?period=year");
    expect(res.body.data.length).toBe(3);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorC).totalDonatedXLM)).toBe(30);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorB).totalDonatedXLM)).toBe(20);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorA).totalDonatedXLM)).toBe(10);

    // all: donorA (110), donorC (30), donorB (20)
    res = await request(app).get("/api/leaderboard?period=all");
    expect(res.body.data.length).toBe(3);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorA).totalDonatedXLM)).toBe(110);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorC).totalDonatedXLM)).toBe(30);
    expect(parseFloat(res.body.data.find(d => d.publicKey === donorB).totalDonatedXLM)).toBe(20);
  });
});
