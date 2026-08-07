"use strict";

const fs = require("fs");
const path = require("path");
const { GenericContainer, Wait } = require("testcontainers");
const { Pool } = require("pg");

let container;
let pool;
let testPool;
let serverContainerReady = false;

function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}

describe("profileQueue badge computation", () => {
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
      delete require.cache[require.resolve("./store")];
      delete require.cache[require.resolve("./profileQueue")];

      pool = require("../db/pool");
      await pool.query("SELECT 1");

      serverContainerReady = true;
      console.log(`Testcontainers PostgreSQL ready at ${host}:${port}`);
    } catch (err) {
      console.warn("Testcontainers startup failed – integration tests will be skipped:", err.message);
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

  test("badges computed correctly after multiple donations", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await cleanDb();

    const { processProfileUpdate } = require("./profileQueue");
    const donorAddress = makePublicKey("A");
    const projectId = "11111111-1111-1111-1111-111111111111";

    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [projectId, "Test Project", "Test project for badge integration", "Reforestation", "Brazil", makePublicKey("Z"), "50000"],
    );

    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        projectId,
        donorAddress,
        "5.0000000",
        "5.0000000",
        "XLM",
        "a".repeat(64),
      ],
    );

    await processProfileUpdate(donorAddress);

    const profile1 = await testPool.query(
      "SELECT total_donated_xlm, badges FROM profiles WHERE public_key = $1",
      [donorAddress],
    );
    expect(parseFloat(profile1.rows[0].total_donated_xlm)).toBeCloseTo(5, 5);
    expect(profile1.rows[0].badges).toEqual([]);

    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        projectId,
        donorAddress,
        "5.0000000",
        "5.0000000",
        "XLM",
        "b".repeat(64),
      ],
    );

    await processProfileUpdate(donorAddress);

    const profile2 = await testPool.query(
      "SELECT total_donated_xlm, badges FROM profiles WHERE public_key = $1",
      [donorAddress],
    );
    expect(parseFloat(profile2.rows[0].total_donated_xlm)).toBeCloseTo(10, 5);
    expect(profile2.rows[0].badges).toHaveLength(1);
    expect(profile2.rows[0].badges[0].tier).toBe("seedling");

    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
        projectId,
        donorAddress,
        "90.0000000",
        "90.0000000",
        "XLM",
        "c".repeat(64),
      ],
    );

    await processProfileUpdate(donorAddress);

    const profile3 = await testPool.query(
      "SELECT total_donated_xlm, badges FROM profiles WHERE public_key = $1",
      [donorAddress],
    );
    expect(parseFloat(profile3.rows[0].total_donated_xlm)).toBeCloseTo(100, 5);
    expect(profile3.rows[0].badges).toHaveLength(1);
    expect(profile3.rows[0].badges[0].tier).toBe("tree");
  });
});
