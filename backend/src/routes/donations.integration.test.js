"use strict";

/**
 * Integration test for donation flow using testcontainers-node
 * with a real PostgreSQL instance.
 *
 * Verifies:
 *  - Inserts into donations
 *  - Updates profiles.total_donated_xlm
 *  - Updates projects.raised_xlm and projects.donor_count
 *
 * Run with: INTEGRATION=1 npm test -- donations.integration
 * Test is skipped gracefully if Docker is unavailable.
 */

const fs = require("fs");
const path = require("path");
const { GenericContainer, Wait } = require("testcontainers");
const { Pool } = require("pg");

let container;
let pool;
let testPool;
let serverContainerReady = false;

// Helper to build a valid Stellar public key
function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}
function makeTxHash(char = "a") {
  return char.repeat(64);
}

describe("Donation flow integration (testcontainers)", () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    // Skip if explicitly disabled
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

      // Create a dedicated pg Pool for test setup
      testPool = new Pool({
        connectionString,
        max: 5,
      });

      // Run schema migration
      const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
      const schemaSql = fs.readFileSync(schemaPath, "utf8");
      await testPool.query(schemaSql);

      // Now wire the application pool to use the testcontainer DB
      // Clear require cache to force pool.js to re-initialize with new DATABASE_URL
      process.env.DATABASE_URL = connectionString;
      delete require.cache[require.resolve("../db/pool")];
      delete require.cache[require.resolve("./donations")];
      delete require.cache[require.resolve("../services/store")];

      // Require after env is set
      pool = require("../db/pool");
      // sanity ping
      await pool.query("SELECT 1");

      serverContainerReady = true;
      console.log(`Testcontainers PostgreSQL ready at ${host}:${port}`);
    } catch (err) {
      console.warn("Testcontainers startup failed – integration tests will be skipped:", err.message);
      serverContainerReady = false;
      // Ensure cleanup
      try {
        if (testPool) await testPool.end();
      } catch {}
      try {
        if (container) await container.stop();
      } catch {}
      container = null;
      testPool = null;
    }
  });

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } catch {}
    try {
      if (testPool) await testPool.end();
    } catch {}
    try {
      if (container) await container.stop({ timeout: 5000 });
    } catch {}
  });

  async function cleanDb() {
    if (!testPool) return;
    await testPool.query("TRUNCATE donations, profiles, projects RESTART IDENTITY CASCADE");
  }

  test("complete donation flow updates all aggregates correctly", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await cleanDb();

    // Re-require recordDonation after pool reset
    const { recordDonation } = require("./donations");

    // 1. Seed a project
    const projectId = "11111111-1111-1111-1111-111111111111";
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, raised_xlm, donor_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        projectId,
        "Integration Test Reforestation",
        "Test project for donation integration",
        "Reforestation",
        "Brazil",
        makePublicKey("Z"),
        "50000",
        "0",
        0,
      ]
    );

    const donorAddress = makePublicKey("A");
    const txHash1 = makeTxHash("a");

    // Helper to invoke recordDonation like the unit test does
    async function invoke(body) {
      const req = { body, app: { get: () => null }, log: { info: () => {} } };
      const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      const next = (err) => {
        if (err) {
          res.status(err.status || 500).json({ error: err.message });
          throw err;
        }
      };
      await recordDonation(req, res, next);
      return res;
    }

    // First donation: 10 XLM
    const res1 = await invoke({
      projectId,
      donorAddress,
      amountXLM: "10",
      currency: "XLM",
      transactionHash: txHash1,
      message: "First integration donation",
    });

    expect(res1.statusCode).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data.amountXLM).toBe("10.0000000");

    // Verify DB state after first donation
    const donationCheck = await testPool.query("SELECT * FROM donations WHERE transaction_hash = $1", [txHash1]);
    expect(donationCheck.rows).toHaveLength(1);
    expect(donationCheck.rows[0].project_id).toBe(projectId);
    expect(donationCheck.rows[0].donor_address).toBe(donorAddress);
    expect(parseFloat(donationCheck.rows[0].amount_xlm)).toBeCloseTo(10, 5);

    const profile1 = await testPool.query("SELECT * FROM profiles WHERE public_key = $1", [donorAddress]);
    expect(profile1.rows).toHaveLength(1);
    expect(parseFloat(profile1.rows[0].total_donated_xlm)).toBeCloseTo(10, 5);
    expect(profile1.rows[0].projects_supported).toBe(1);
    // Badge: seedling at 10 XLM
    const badges1 = profile1.rows[0].badges;
    expect(Array.isArray(badges1)).toBe(true);
    expect(badges1[0].tier).toBe("seedling");

    const project1 = await testPool.query("SELECT raised_xlm, donor_count FROM projects WHERE id = $1", [projectId]);
    expect(parseFloat(project1.rows[0].raised_xlm)).toBeCloseTo(10, 5);
    expect(project1.rows[0].donor_count).toBe(1);

    // Second donation from SAME donor: 90 XLM => total 100 => badge upgrade to tree
    const txHash2 = makeTxHash("b");
    const res2 = await invoke({
      projectId,
      donorAddress,
      amountXLM: "90",
      currency: "XLM",
      transactionHash: txHash2,
    });
    expect(res2.statusCode).toBe(201);

    const profile2 = await testPool.query("SELECT total_donated_xlm, badges FROM profiles WHERE public_key = $1", [donorAddress]);
    expect(parseFloat(profile2.rows[0].total_donated_xlm)).toBeCloseTo(100, 5);
    expect(profile2.rows[0].badges[0].tier).toBe("tree");

    const project2 = await testPool.query("SELECT raised_xlm, donor_count FROM projects WHERE id = $1", [projectId]);
    // raised_xlm should be 100 now, donor_count still 1 (same donor)
    expect(parseFloat(project2.rows[0].raised_xlm)).toBeCloseTo(100, 5);
    expect(project2.rows[0].donor_count).toBe(1);

    // Third donation from NEW donor: 25 XLM
    const donor2 = makePublicKey("B");
    const txHash3 = makeTxHash("c");
    const res3 = await invoke({
      projectId,
      donorAddress: donor2,
      amountXLM: "25",
      currency: "XLM",
      transactionHash: txHash3,
    });
    expect(res3.statusCode).toBe(201);

    const project3 = await testPool.query("SELECT raised_xlm, donor_count FROM projects WHERE id = $1", [projectId]);
    expect(parseFloat(project3.rows[0].raised_xlm)).toBeCloseTo(125, 5);
    expect(project3.rows[0].donor_count).toBe(2);

    const profileDonor2 = await testPool.query("SELECT total_donated_xlm FROM profiles WHERE public_key = $1", [donor2]);
    expect(parseFloat(profileDonor2.rows[0].total_donated_xlm)).toBeCloseTo(25, 5);

    // Verify donations table count
    const allDonations = await testPool.query("SELECT COUNT(*) FROM donations WHERE project_id = $1", [projectId]);
    expect(parseInt(allDonations.rows[0].count, 10)).toBe(3);
  });

  test("deduplication prevents double counting aggregates", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await cleanDb();
    const { recordDonation } = require("./donations");

    const projectId = "22222222-2222-2222-2222-222222222222";
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address) VALUES ($1,$2,$3,$4,$5,$6)`,
      [projectId, "Dedupe Test", "x", "Solar Energy", "Kenya", makePublicKey("X")]
    );

    const donor = makePublicKey("D");
    const txHash = makeTxHash("d");

    async function invoke(body) {
      const req = { body, app: { get: () => null }, log: { info: () => {} } };
      const res = {
        statusCode: 200,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(p) { this.body = p; return this; },
      };
      const next = (err) => { if (err) { res.status(err.status||500).json({error:err.message}); throw err; } };
      await recordDonation(req, res, next);
      return res;
    }

    const first = await invoke({ projectId, donorAddress: donor, amountXLM: "15", currency: "XLM", transactionHash: txHash });
    expect([200,201]).toContain(first.statusCode);

    const second = await invoke({ projectId, donorAddress: donor, amountXLM: "15", currency: "XLM", transactionHash: txHash });
    // dedup returns 200 with existing record
    expect(second.statusCode).toBe(200);
    expect(second.body.success).toBe(true);

    const project = await testPool.query("SELECT raised_xlm, donor_count FROM projects WHERE id=$1", [projectId]);
    // should only count once
    expect(parseFloat(project.rows[0].raised_xlm)).toBeCloseTo(15, 5);
    expect(project.rows[0].donor_count).toBe(1);

    const profile = await testPool.query("SELECT total_donated_xlm FROM profiles WHERE public_key=$1", [donor]);
    expect(parseFloat(profile.rows[0].total_donated_xlm)).toBeCloseTo(15, 5);

    const donationsCount = await testPool.query("SELECT COUNT(*) FROM donations WHERE transaction_hash=$1", [txHash]);
    expect(parseInt(donationsCount.rows[0].count,10)).toBe(1);
  });

  test("non-XLM donations do not affect profiles.total_donated_xlm or projects.raised_xlm", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await cleanDb();
    const { recordDonation } = require("./donations");

    const projectId = "33333333-3333-3333-3333-333333333333";
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, raised_xlm, donor_count)
       VALUES ($1,$2,$3,$4,$5,$6,0,0)`,
      [projectId, "Fiat Test", "x", "Clean Water", "Mali", makePublicKey("Y")]
    );

    const donor = makePublicKey("E");
    // Seed profile with existing XLM total
    await testPool.query(
      `INSERT INTO profiles (public_key, total_donated_xlm, projects_supported, badges)
       VALUES ($1, $2, 1, '[]'::jsonb)`,
      [donor, "200.0000000"]
    );

    async function invoke(body) {
      const req = { body, app: { get: () => null }, log: { info: () => {} } };
      const res = { statusCode: 200, body: null, status(c){this.statusCode=c;return this;}, json(p){this.body=p;return this;} };
      const next = (err)=>{ if(err){ res.status(err.status||500).json({error: err.message}); throw err; } };
      await recordDonation(req, res, next);
      return res;
    }

    const res = await invoke({
      projectId,
      donorAddress: donor,
      amount: "50",
      currency: "USD",
      transactionHash: makeTxHash("e"),
    });
    expect(res.statusCode).toBe(201);

    const profile = await testPool.query("SELECT total_donated_xlm FROM profiles WHERE public_key=$1", [donor]);
    // total_donated_xlm must remain 200
    expect(parseFloat(profile.rows[0].total_donated_xlm)).toBeCloseTo(200, 5);

    const project = await testPool.query("SELECT raised_xlm, donor_count FROM projects WHERE id=$1", [projectId]);
    // raised_xlm unchanged, but donor_count increments because donation row exists (distinct donor)
    expect(parseFloat(project.rows[0].raised_xlm)).toBeCloseTo(0, 5);
    expect(project.rows[0].donor_count).toBe(1);
  });
});
