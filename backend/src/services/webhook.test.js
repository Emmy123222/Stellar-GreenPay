/**
 * backend/src/services/webhook.test.js
 * Unit tests for webhook delivery SSRF protection.
 *
 * NOTE: DNS resolution is mocked to avoid flaky network-dependent tests.
 *       The one "smoke test" with real DNS is explicitly marked with a longer
 *       timeout so it can be skipped in offline / CI environments via
 *       `jest --testPathIgnorePatterns=smoke`.
 */
"use strict";

const dns = require("dns");
const http = require("http");
const https = require("https");
const { deliverPayload, isPrivateIP } = require("./webhook");
const logger = require("../logger");

jest.mock("dns", () => ({
  promises: {
    lookup: jest.fn(),
  },
}));
process.env.NODE_ENV = "test";



describe("SSRF Protection - isPrivateIP", () => {
  test("identifies loopback addresses (127.0.0.0/8)", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
    expect(isPrivateIP("127.0.0.254")).toBe(true);
    expect(isPrivateIP("127.255.255.255")).toBe(true);
  });

  test("identifies private class A range (10.0.0.0/8)", () => {
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("10.255.255.255")).toBe(true);
  });

  test("identifies private class B range (172.16.0.0/12)", () => {
    expect(isPrivateIP("172.16.0.1")).toBe(true);
    expect(isPrivateIP("172.31.255.255")).toBe(true);
    expect(isPrivateIP("172.15.255.255")).toBe(false);
    expect(isPrivateIP("172.32.0.1")).toBe(false);
  });

  test("identifies private class C range (192.168.0.0/16)", () => {
    expect(isPrivateIP("192.168.0.1")).toBe(true);
    expect(isPrivateIP("192.168.255.255")).toBe(true);
    expect(isPrivateIP("192.169.0.1")).toBe(false);
  });

  test("identifies link-local / cloud metadata range (169.254.0.0/16)", () => {
    expect(isPrivateIP("169.254.169.254")).toBe(true);
    expect(isPrivateIP("169.254.0.1")).toBe(true);
  });

  test("identifies 0.0.0.0/8 range", () => {
    expect(isPrivateIP("0.0.0.0")).toBe(true);
  });

  test("allows public IPv4 addresses", () => {
    expect(isPrivateIP("8.8.8.8")).toBe(false);
    expect(isPrivateIP("1.1.1.1")).toBe(false);
    expect(isPrivateIP("93.184.216.34")).toBe(false);
  });

  test("handles IPv6 loopback and restricted ranges", () => {
    expect(isPrivateIP("::1")).toBe(true);
    expect(isPrivateIP("::")).toBe(true);
    expect(isPrivateIP("fe80::1")).toBe(true);
    expect(isPrivateIP("fd00::1")).toBe(true);
  });

  test("handles IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIP("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIP("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("deliverPayload SSRF Protection", () => {
  let httpReqSpy;
  let httpsReqSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    httpReqSpy = jest.spyOn(http, "request").mockImplementation(() => {
      const mockReq = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
      };
      return mockReq;
    });

    httpsReqSpy = jest.spyOn(https, "request").mockImplementation(() => {
      const mockReq = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
      };
      return mockReq;
    });
  });

  afterEach(() => {
    httpReqSpy.mockRestore();
    httpsReqSpy.mockRestore();
  });

  test("blocks delivery when DNS resolves to a private IP (127.0.0.1)", async () => {
    dns.promises.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    await deliverPayload("http://internal-service.local/webhook", "secret123", { projectId: "p1", milestone: "M1" });

    expect(dns.promises.lookup).toHaveBeenCalledWith("internal-service.local", { all: true });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "webhook_delivery_error",
        ip: "127.0.0.1",
      }),
      expect.stringContaining("Blocked private or restricted IP address")
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  test("blocks delivery when DNS resolves to cloud metadata IP (169.254.169.254)", async () => {
    dns.promises.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    await deliverPayload("http://169.254.169.254/latest/meta-data/", "secret123", { projectId: "p1", milestone: "M1" });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "webhook_delivery_error",
        ip: "169.254.169.254",
      }),
      expect.stringContaining("Blocked private or restricted IP address")
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  test("blocks delivery when DNS resolution fails", async () => {
    dns.promises.lookup.mockRejectedValue(new Error("ENOTFOUND"));

    await deliverPayload("http://invalid-domain-does-not-exist.test/webhook", "secret123", { projectId: "p1", milestone: "M1" });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "webhook_delivery_error",
      }),
      expect.stringContaining("DNS resolution error")
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  test("allows delivery when DNS resolves to a public IP address", async () => {
    dns.promises.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await deliverPayload("https://api.example.com/webhook", "secret123", { projectId: "p1", milestone: "M1" });

    expect(dns.promises.lookup).toHaveBeenCalledWith("api.example.com", { all: true });
    expect(https.request).toHaveBeenCalled();
jest.mock("http", () => ({ request: jest.fn() }));
jest.mock("https", () => ({ request: jest.fn() }));

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
  }, 15000);
});

