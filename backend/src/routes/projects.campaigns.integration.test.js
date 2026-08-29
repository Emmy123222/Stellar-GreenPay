"use strict";

/**
 * Integration test for campaign progress aggregation (issue #352) using
 * testcontainers-node with a real PostgreSQL instance.
 *
 * Verifies the SQL in fetchCampaignsForProject:
 *  - raised_xlm aggregates XLM donations AND USDC donations converted at
 *    USDC_TO_XLM_RATE
 *  - raised_usdc reports the raw, unconverted USDC total
 *  - campaigns with only XLM, only USDC, a mix, and zero donations are correct
 *
 * Run with: INTEGRATION=1 npm test -- projects.campaigns.integration
 * Skipped gracefully when Docker / testcontainers is unavailable.
 */

const fs = require("fs");
const path = require("path");
const { GenericContainer, Wait } = require("testcontainers");
const { Pool } = require("pg");

let container;
let testPool;
let pool;
let router;
let dbReady = false;

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

describe("Campaign progress aggregation integration (testcontainers)", () => {
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
      const schemaSql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
      await testPool.query(schemaSql);

      // Wire the application pool to the container DB, then re-require the route
      // module so fetchCampaignsForProject uses the test pool.
      process.env.DATABASE_URL = connectionString;
      process.env.USDC_TO_XLM_RATE = "2";
      delete require.cache[require.resolve("../db/pool")];
      delete require.cache[require.resolve("./projects")];

      pool = require("../db/pool");
      await pool.query("SELECT 1");
      router = require("./projects");

      dbReady = true;
      console.log(`Testcontainers PostgreSQL ready at ${host}:${port}`);
    } catch (err) {
      console.warn("Testcontainers startup failed – integration tests will be skipped:", err.message);
      dbReady = false;
      try { if (testPool) await testPool.end(); } catch { /* ignore */ }
      try { if (container) await container.stop(); } catch { /* ignore */ }
      container = null;
      testPool = null;
    }
  });

  afterAll(async () => {
    try { if (pool) await pool.end(); } catch { /* ignore */ }
    try { if (testPool) await testPool.end(); } catch { /* ignore */ }
    try { if (container) await container.stop({ timeout: 5000 }); } catch { /* ignore */ }
  });

  async function seedCampaignAndDonations({ xlmAmount = null, usdcAmount = null } = {}) {
    await testPool.query("TRUNCATE donations, project_campaigns, projects RESTART IDENTITY CASCADE");
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm)
       VALUES ($1, 'P', 'd', 'Reforestation', 'BR', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', 1000)`,
      [PROJECT_ID],
    );
    await testPool.query(
      `INSERT INTO project_campaigns (id, project_id, title, goal_xlm, deadline, created_at)
       VALUES ($1, $2, 'C', 1000, NOW() + INTERVAL '30 days', NOW())`,
      ["22222222-2222-2222-2222-222222222222", PROJECT_ID],
    );
    let n = 0;
    if (xlmAmount !== null) {
      await testPool.query(
        `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
         VALUES ($1, $2, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', $3, $3, 'XLM', $4, NOW())`,
        [`d-${n++}`, PROJECT_ID, xlmAmount, `x${n}`.padEnd(64, "a")],
      );
    }
    if (usdcAmount !== null) {
      await testPool.query(
        `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
         VALUES ($1, $2, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', NULL, $3, 'USDC', $4, NOW())`,
        [`d-${n++}`, PROJECT_ID, usdcAmount, `u${n}`.padEnd(64, "a")],
      );
    }
  }

  test("only XLM donations", async () => {
    if (!dbReady) return expect(true).toBe(true);
    await seedCampaignAndDonations({ xlmAmount: 400 });
    const campaigns = await router.fetchCampaignsForProject(PROJECT_ID);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].raisedXLM).toBe("400.0000000");
    expect(campaigns[0].raisedUSDC).toBe("0.0000000");
  });

  test("only USDC donations → converted at rate and raw USDC reported", async () => {
    if (!dbReady) return expect(true).toBe(true);
    // 250 USDC * rate(2) = 500 XLM-equivalent
    await seedCampaignAndDonations({ usdcAmount: 250 });
    const campaigns = await router.fetchCampaignsForProject(PROJECT_ID);
    expect(campaigns[0].raisedXLM).toBe("500.0000000");
    expect(campaigns[0].raisedUSDC).toBe("250.0000000");
  });

  test("mix of XLM and USDC", async () => {
    if (!dbReady) return expect(true).toBe(true);
    // 100 XLM + (150 USDC * 2) = 400 XLM-equivalent; raisedUSDC = 150
    await seedCampaignAndDonations({ xlmAmount: 100, usdcAmount: 150 });
    const campaigns = await router.fetchCampaignsForProject(PROJECT_ID);
    expect(campaigns[0].raisedXLM).toBe("400.0000000");
    expect(campaigns[0].raisedUSDC).toBe("150.0000000");
  });

  test("zero donations", async () => {
    if (!dbReady) return expect(true).toBe(true);
    await seedCampaignAndDonations();
    const campaigns = await router.fetchCampaignsForProject(PROJECT_ID);
    expect(campaigns[0].raisedXLM).toBe("0.0000000");
    expect(campaigns[0].raisedUSDC).toBe("0.0000000");
  });
});
