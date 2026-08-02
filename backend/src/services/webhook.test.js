"use strict";

/**
 * Webhook signature validation integration test
 *
 * Verifies:
 *  1. A test HTTP server receives webhook POSTs when milestones are reached
 *  2. The X-Webhook-Signature header equals HMAC-SHA256(body, webhook_secret)
 *  3. The payload contains the correct milestone.reached event shape
 *
 * Run with: INTEGRATION=1 npm test -- webhook.test
 * Test is skipped gracefully if Docker is unavailable.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { GenericContainer, Wait } = require("testcontainers");
const { Pool } = require("pg");

let container;
let testPool;
let serverContainerReady = false;

describe("Webhook signature validation (testcontainers)", () => {
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

      testPool = new Pool({
        connectionString,
        max: 5,
      });

      const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
      const schemaSql = fs.readFileSync(schemaPath, "utf8");
      await testPool.query(schemaSql);

      process.env.DATABASE_URL = connectionString;
      delete require.cache[require.resolve("../db/pool")];
      delete require.cache[require.resolve("./webhook")];

      // Sanity ping to confirm pool is wired correctly
      const pool = require("../db/pool");
      await pool.query("SELECT 1");

      serverContainerReady = true;
      console.log(`Testcontainers PostgreSQL ready at ${host}:${port}`);
    } catch (err) {
      console.warn("Testcontainers startup failed – integration tests will be skipped:", err.message);
      serverContainerReady = false;
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
      const pool = require("../db/pool");
      await pool.end();
    } catch {}
    try {
      if (testPool) await testPool.end();
    } catch {}
    try {
      if (container) await container.stop({ timeout: 5000 });
    } catch {}
  });

  /**
   * Start a tiny HTTP server on a random port. Returns { port, server }.
   * Attach your own 'request' listener to `server` after calling this.
   */
  function startCaptureServer() {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        resolve({ port, server });
      });
    });
  }

  /**
   * Helper to shut down a server cleanly.
   */
  function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
  }

  test("delivers signed milestone webhooks with correct HMAC-SHA256 signature", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    // Clean state
    await testPool.query("TRUNCATE projects, project_milestones RESTART IDENTITY CASCADE");

    // Re-require after pool reset
    const { checkAndDeliverMilestones } = require("./webhook");
    const pool = require("../db/pool");

    // ── 1. Start the capture server ────────────────────────────────────
    const { port, server } = await startCaptureServer();
    const webhookUrl = `http://127.0.0.1:${port}/webhook`;
    const webhookSecret = "whsec_supersecret_test_key_12345";

    // Track received requests
    const received = [];
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        received.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    // ── 2. Seed a project with webhook config ──────────────────────────
    const projectId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, raised_xlm, webhook_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        projectId,
        "Webhook Test Project",
        "Testing milestone webhooks",
        "Reforestation",
        "Brazil",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "100",       // goal: 100 XLM
        "55",        // raised: 55 XLM → 55% progress
        webhookUrl,
        webhookSecret,
      ]
    );

    // ── 3. Seed milestones ────────────────────────────────────────────
    // 25% milestone – should trigger (55% >= 25%)
    // 50% milestone – should trigger (55% >= 50%)
    // 75% milestone – should NOT trigger (55% < 75%)
    const milestone25Id = "22222222-2222-2222-2222-222222222222";
    const milestone50Id = "33333333-3333-3333-3333-333333333333";
    const milestone75Id = "44444444-4444-4444-4444-444444444444";

    await testPool.query(
      `INSERT INTO project_milestones (id, project_id, percentage, title)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)`,
      [
        milestone25Id, projectId, 25, "Quarter funded",
        milestone50Id, projectId, 50, "Halfway there",
        milestone75Id, projectId, 75, "Almost done",
      ]
    );

    // ── 4. Trigger milestone check ────────────────────────────────────
    await checkAndDeliverMilestones(projectId);

    // Webhook delivery is async (fire-and-forget), so wait a bit
    await new Promise((r) => setTimeout(r, 2000));

    // ── 5. Shut down the capture server ───────────────────────────────
    await closeServer(server);

    // ── 6. Assertions ─────────────────────────────────────────────────

    // Expect two webhooks delivered (25% and 50%)
    expect(received.length).toBe(2);
    expect(received.every((r) => r.method === "POST")).toBe(true);

    const receivedUrls = received.map((r) => r.url);
    expect(receivedUrls.every((u) => u === "/webhook")).toBe(true);

    // Verify each received webhook
    for (const req of received) {
      // ── 6a. Verify X-Webhook-Signature header ────────────────────────
      const sigHeader = req.headers["x-webhook-signature"];
      expect(sigHeader).toBeDefined();

      // Compute expected signature
      const expectedSig = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.body)
        .digest("hex");

      expect(sigHeader).toBe(expectedSig);

      // ── 6b. Verify content-type ─────────────────────────────────────
      expect(req.headers["content-type"]).toBe("application/json");

      // ── 6c. Verify user-agent ───────────────────────────────────────
      expect(req.headers["user-agent"]).toBe("GreenPay-Webhook/1.0");

      // ── 6d. Verify payload shape ────────────────────────────────────
      const payload = JSON.parse(req.body);

      expect(payload.event).toBe("milestone.reached");
      expect(payload.projectId).toBe(projectId);
      expect(payload.totalRaisedXLM).toBe("55.0000000");
      expect(payload).toHaveProperty("timestamp");
      expect(payload).toHaveProperty("percentage");
      expect(payload).toHaveProperty("milestone");

      // Validate timestamp is ISO 8601
      expect(() => new Date(payload.timestamp)).not.toThrow();
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);

      // Validate percentage is one of the triggered milestones
      expect([25, 50]).toContain(payload.percentage);

      // Validate milestone title matches
      if (payload.percentage === 25) {
        expect(payload.milestone).toBe("Quarter funded");
      } else if (payload.percentage === 50) {
        expect(payload.milestone).toBe("Halfway there");
      }
    }

    // ── 6e. Verify milestone 75% was NOT triggered ────────────────────
    const payloads = received.map((r) => JSON.parse(r.body));
    const percentages = payloads.map((p) => p.percentage);
    expect(percentages).not.toContain(75);

    // ── 6f. Verify DB milestones were updated ─────────────────────────
    const dbMilestones = await testPool.query(
      "SELECT id, percentage, reached_at FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [projectId]
    );

    expect(dbMilestones.rows).toHaveLength(3);
    // 25% milestone: reached_at should be set
    expect(dbMilestones.rows[0].reached_at).not.toBeNull();
    // 50% milestone: reached_at should be set
    expect(dbMilestones.rows[1].reached_at).not.toBeNull();
    // 75% milestone: reached_at should still be null
    expect(dbMilestones.rows[2].reached_at).toBeNull();
  });

  test("triggers milestone webhooks via a donation that pushes raised_xlm past a threshold", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    // Clean state
    await testPool.query("TRUNCATE projects, project_milestones, donations RESTART IDENTITY CASCADE");

    // Re-require after pool reset
    const { checkAndDeliverMilestones } = require("./webhook");

    // ── 1. Start the capture server ────────────────────────────────────
    const { port, server } = await startCaptureServer();
    const webhookUrl = `http://127.0.0.1:${port}/webhook`;
    const webhookSecret = "whsec_donation_triggered_test_key";

    // Track received requests
    const received = [];
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        received.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    // ── 2. Seed a project with webhook config and NO initial raised_xlm ─
    const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, raised_xlm, webhook_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        projectId,
        "Donation-Triggered Webhook Project",
        "Testing donation → milestone → webhook pipeline",
        "Solar Energy",
        "India",
        "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDY",
        "200",       // goal: 200 XLM
        "0",         // initially 0 raised — no milestones reached yet
        webhookUrl,
        webhookSecret,
      ]
    );

    // ── 3. Seed milestones ────────────────────────────────────────────
    // None should be initially reached (raised_xlm = 0)
    const milestone15Id = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const milestone30Id = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    await testPool.query(
      `INSERT INTO project_milestones (id, project_id, percentage, title)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        milestone15Id, projectId, 15, "15% funded — first light",
        milestone30Id, projectId, 30, "30% funded — panels ordered",
      ]
    );

    // ── 4. Record a donation that pushes raised past the 15% milestone ─
    const donorAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const donationAmount = 35; // 35 / 200 = 17.5% → crosses the 15% milestone

    await testPool.query(
      `INSERT INTO donations (id, project_id, donor_address, amount_xlm, amount, currency, transaction_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        "11111111-1111-1111-1111-111111111111",
        projectId,
        donorAddress,
        donationAmount,
        donationAmount,
        "XLM",
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      ]
    );

    // Update raised_xlm on the project to reflect the donation
    await testPool.query(
      `UPDATE projects
       SET raised_xlm = raised_xlm + $1::numeric,
           donor_count = (
             SELECT COUNT(DISTINCT donor_address)
             FROM donations
             WHERE project_id = $2
           ),
           updated_at = NOW()
       WHERE id = $2`,
      [donationAmount, projectId]
    );

    // ── 5. Trigger milestone check (as would happen after a donation) ──
    await checkAndDeliverMilestones(projectId);

    // Webhook delivery is async (fire-and-forget), so wait a bit
    await new Promise((r) => setTimeout(r, 2000));

    // ── 6. Shut down the capture server ───────────────────────────────
    await closeServer(server);

    // ── 7. Assertions ─────────────────────────────────────────────────

    // Expect exactly one webhook delivered (15% milestone)
    expect(received.length).toBe(1);
    expect(received[0].method).toBe("POST");
    expect(received[0].url).toBe("/webhook");

    // ── 7a. Verify X-Webhook-Signature header ──────────────────────────
    const sigHeader = received[0].headers["x-webhook-signature"];
    expect(sigHeader).toBeDefined();

    const expectedSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(received[0].body)
      .digest("hex");
    expect(sigHeader).toBe(expectedSig);

    // ── 7b. Verify content-type and user-agent ─────────────────────────
    expect(received[0].headers["content-type"]).toBe("application/json");
    expect(received[0].headers["user-agent"]).toBe("GreenPay-Webhook/1.0");

    // ── 7c. Verify payload shape ──────────────────────────────────────
    const payload = JSON.parse(received[0].body);

    expect(payload.event).toBe("milestone.reached");
    expect(payload.projectId).toBe(projectId);
    expect(payload.percentage).toBe(15);
    expect(payload.milestone).toBe("15% funded — first light");
    expect(payload).toHaveProperty("timestamp");
    expect(payload).toHaveProperty("totalRaisedXLM");

    // totalRaisedXLM should reflect the donation amount (35 / 200 = 17.5%)
    expect(payload.totalRaisedXLM).toBe("35.0000000");

    // timestamp should be valid ISO 8601
    expect(() => new Date(payload.timestamp)).not.toThrow();
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);

    // ── 7d. Verify 30% milestone was NOT triggered ─────────────────────
    const dbMilestones = await testPool.query(
      "SELECT id, percentage, reached_at FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [projectId]
    );

    expect(dbMilestones.rows).toHaveLength(2);
    // 15% milestone: reached_at should be set
    expect(dbMilestones.rows[0].reached_at).not.toBeNull();
    // 30% milestone: reached_at should still be null (17.5% < 30%)
    expect(dbMilestones.rows[1].reached_at).toBeNull();

    // ── 7e. Verify the donation record is intact ───────────────────────
    const donationRows = await testPool.query(
      "SELECT id, amount_xlm, donor_address FROM donations WHERE project_id = $1",
      [projectId]
    );
    expect(donationRows.rows).toHaveLength(1);
    expect(Number.parseFloat(donationRows.rows[0].amount_xlm)).toBe(donationAmount);
    expect(donationRows.rows[0].donor_address).toBe(donorAddress);
  });

  test("does not deliver webhooks when project has no webhook_url configured", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await testPool.query("TRUNCATE projects, project_milestones RESTART IDENTITY CASCADE");

    const { checkAndDeliverMilestones } = require("./webhook");

    const { server } = await startCaptureServer();

    const received = [];
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        received.push({ url: req.url });
        res.writeHead(200);
        res.end();
      });
    });

    const projectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, raised_xlm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        projectId,
        "No Webhook Project",
        "Project without webhook config",
        "Clean Water",
        "Kenya",
        "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBY",
        "100",
        "60", // 60% progress
      ]
    );

    // Seed a milestone that would be reached
    await testPool.query(
      `INSERT INTO project_milestones (id, project_id, percentage, title)
       VALUES ($1, $2, $3, $4)`,
      ["cccccccc-cccc-cccc-cccc-cccccccccccc", projectId, 50, "Halfway there"]
    );

    await checkAndDeliverMilestones(projectId);
    await new Promise((r) => setTimeout(r, 2000));
    await closeServer(server);

    // No webhook should have been delivered
    expect(received.length).toBe(0);
process.env.NODE_ENV = "test";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock("http", () => ({ request: jest.fn() }));
jest.mock("https", () => ({ request: jest.fn() }));

jest.mock("dns", () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const dns = require("dns");
const http = require("http");
const https = require("https");
const logger = require("../logger");
const { deliverPayload } = require("./webhook");

function mockRequest(lib) {
  const req = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn(),
  };
  lib.request.mockReturnValue(req);
  return req;
}

describe("deliverPayload SSRF defense-in-depth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("blocks delivery to a private/blocked address and never makes an outbound request", async () => {
    const req = mockRequest(https);

    await deliverPayload(
      "http://169.254.169.254/metadata",
      "secret",
      { projectId: "proj-1", milestone: "50%" },
    );

    expect(https.request).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(req.write).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "webhook_blocked_ssrf" }),
      expect.any(String),
    );
  });

  test("blocks delivery to localhost", async () => {
    mockRequest(http);

    await deliverPayload("http://localhost:8080/internal", "secret", {
      projectId: "proj-1",
      milestone: "50%",
    });

    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test("does not reject even when the URL is blocked (fire-and-forget safe)", async () => {
    await expect(
      deliverPayload("http://127.0.0.1/", "secret", { projectId: "p", milestone: "m" }),
    ).resolves.toBeUndefined();
  });

  test("delivers normally to a public URL", async () => {
    dns.promises.resolve4.mockResolvedValue(["104.21.0.1"]);
    dns.promises.resolve6.mockRejectedValue(new Error("ENODATA"));
    const req = mockRequest(https);

    await deliverPayload("https://webhook.site/xyz", "secret", {
      projectId: "proj-1",
      milestone: "50%",
    });

    expect(https.request).toHaveBeenCalledTimes(1);
    expect(req.write).toHaveBeenCalledTimes(1);
    expect(req.end).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "webhook_blocked_ssrf" }),
      expect.any(String),
    );
  });
});
