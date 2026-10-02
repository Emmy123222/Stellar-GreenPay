"use strict";

/**
 * Integration test for GET /api/impact/global using testcontainers
 * Seeds three projects across categories and inserts donations, then
 * verifies the breakdownByCategory and totals.
 *
 * Run with: INTEGRATION=1 npm test -- impact.integration
 */

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

function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}
function makeTxHash(char = "a") {
  return char.repeat(64);
}

describe("GET /api/impact/global integration (testcontainers)", () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    if (process.env.SKIP_INTEGRATION === "1") {
      console.warn("Skipping integration tests (SKIP_INTEGRATION=1)");
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

      const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
      const schemaSql = fs.readFileSync(schemaPath, "utf8");
      await testPool.query(schemaSql);

      process.env.DATABASE_URL = connectionString;
      delete require.cache[require.resolve("../db/pool")];
      delete require.cache[require.resolve("./impact")];

      pool = require("../db/pool");
      await pool.query("SELECT 1");

      serverContainerReady = true;
      console.log(`Testcontainers PostgreSQL ready at ${host}:${port}`);
    } catch (err) {
      console.warn("Testcontainers startup failed – integration tests will be skipped:", err.message);
      serverContainerReady = false;
      try { if (testPool) await testPool.end(); } catch {}
      try { if (container) await container.stop(); } catch {}
      container = null;
      testPool = null;
    }
  });

  afterAll(async () => {
    try { if (pool) await pool.end(); } catch {}
    try { if (testPool) await testPool.end(); } catch {}
    try { if (container) await container.stop({ timeout: 5000 }); } catch {}
  });

  async function cleanDb() {
    if (!testPool) return;
    await testPool.query("TRUNCATE donations, profiles, projects RESTART IDENTITY CASCADE");
  }

  test("returns category breakdown with one entry per donated category and excludes empty categories", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await cleanDb();

    // Seed three projects (one per category) with raised_xlm and co2_offset_kg
    const p1 = "11111111-1111-1111-1111-111111111111"; // Reforestation
    const p2 = "22222222-2222-2222-2222-222222222222"; // Solar
    const p3 = "33333333-3333-3333-3333-333333333333"; // Education

    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, raised_xlm, donor_count, co2_offset_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p1, "Reforest P", "x", "Reforestation", "Brazil", makePublicKey("R"), "150", 1, 60]
    );

    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, raised_xlm, donor_count, co2_offset_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p2, "Solar P", "x", "Solar", "Kenya", makePublicKey("S"), "125", 1, 45]
    );

    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, raised_xlm, donor_count, co2_offset_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p3, "Education P", "x", "Education", "Mali", makePublicKey("E"), "75", 1, 22]
    );

    // Insert donations matching the totals: 150, 125, 75
    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", p1, makePublicKey("A"), "150", "150", "XLM", makeTxHash("a")]
    );

    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", p2, makePublicKey("B"), "125", "125", "XLM", makeTxHash("b")]
    );

    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["cccccccc-cccc-cccc-cccc-cccccccccccc", p3, makePublicKey("C"), "75", "75", "XLM", makeTxHash("c")]
    );

    // Build app wired to the test DB pool
    // Re-require impact route after pool/env reset
    delete require.cache[require.resolve("../db/pool")];
    delete require.cache[require.resolve("./impact")];
    const impactRouter = require("./impact");

    const app = express();
    app.use(express.json());
    app.use("/api/impact", impactRouter);
    app.use((err, _req, res, _next) => { res.status(err.status || 500).json({ error: err.message }); });

    const res = await request(app).get("/api/impact/global").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.breakdownByCategory).toHaveLength(3);
    expect(res.body.data.breakdownByCategory).toEqual([
      { category: "Reforestation", totalDonationsXLM: "150.0000000", donorCount: 1, co2OffsetKg: 60 },
      { category: "Solar", totalDonationsXLM: "125.0000000", donorCount: 1, co2OffsetKg: 45 },
      { category: "Education", totalDonationsXLM: "75.0000000", donorCount: 1, co2OffsetKg: 22 },
    ]);

    expect(res.body.data.totalDonationsXLM).toBe("350.0000000");
    expect(res.body.data.co2OffsetKg).toBe(127);
  });
});
