/**
 * backend/src/services/webhook.test.js
 * Unit tests for webhook signing/verification, SSRF-safe delivery, and
 * secret rotation, plus an integration test exercising the full
 * donation -> milestone -> webhook delivery pipeline.
 *
 * SSRF-blocking logic itself (isPrivateOrReservedIp / assertPublicHttpUrl)
 * is already thoroughly covered by `backend/src/utils/ssrf.test.js` and is
 * NOT re-tested here. `../utils/ssrf` is mocked below so delivery tests
 * (including the loopback capture server used by the integration test)
 * aren't coupled to that real DNS/IP-range logic; the `deliverPayload`
 * describe block below only verifies that a rejection from
 * `assertPublicHttpUrl` is correctly propagated.
 */
"use strict";

jest.mock("../utils/ssrf", () => ({
  assertPublicHttpUrl: jest.fn(),
}));

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { assertPublicHttpUrl } = require("../utils/ssrf");
const pool = require("../db/pool");
const {
  deliverPayload,
  recordAndDeliver,
  rotateWebhookSecret,
  verifyWebhookSignature,
  generateSignature,
  isGracePeriodActive,
  timingSafeEqualHex,
} = require("./webhook");

beforeEach(() => {
  assertPublicHttpUrl.mockReset();
  assertPublicHttpUrl.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// http/https request mocking helpers, shared by deliverPayload &
// recordAndDeliver tests.
// ---------------------------------------------------------------------------

function createMockReq() {
  const req = {
    on: jest.fn(() => req),
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  };
  return req;
}

/** Simulate a successful HTTP response with the given status code. */
function mockRequestSuccess(lib, statusCode = 200) {
  return jest.spyOn(lib, "request").mockImplementation((_options, callback) => {
    const req = createMockReq();
    const res = {
      statusCode,
      on: jest.fn((event, handler) => {
        if (event === "end") handler();
      }),
    };
    callback(res);
    return req;
  });
}

/** Simulate a request-level network error (e.g. ECONNREFUSED). */
function mockRequestNetworkError(lib, err) {
  return jest.spyOn(lib, "request").mockImplementation(() => {
    const req = createMockReq();
    req.on = jest.fn((event, handler) => {
      if (event === "error") handler(err);
      return req;
    });
    return req;
  });
}

/** Simulate a request timeout. */
function mockRequestTimeout(lib) {
  return jest.spyOn(lib, "request").mockImplementation(() => {
    const req = createMockReq();
    req.on = jest.fn((event, handler) => {
      if (event === "timeout") handler();
      return req;
    });
    return req;
  });
}

// ---------------------------------------------------------------------------
// generateSignature
// ---------------------------------------------------------------------------
describe("generateSignature", () => {
  test("computes an HMAC-SHA256 hex digest for a string payload", () => {
    const sig = generateSignature("my-secret", "hello world");
    const expected = crypto.createHmac("sha256", "my-secret").update("hello world").digest("hex");
    expect(sig).toBe(expected);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test("produces different signatures for different secrets", () => {
    expect(generateSignature("secret-a", "body")).not.toBe(generateSignature("secret-b", "body"));
  });
});

// ---------------------------------------------------------------------------
// isGracePeriodActive
// ---------------------------------------------------------------------------
describe("isGracePeriodActive", () => {
  test("returns false when no expiration is provided", () => {
    expect(isGracePeriodActive(null)).toBe(false);
    expect(isGracePeriodActive(undefined)).toBe(false);
  });

  test("returns true when the expiration is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isGracePeriodActive(future, Date.now())).toBe(true);
  });

  test("returns false when the expiration is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isGracePeriodActive(past)).toBe(false);
  });

  test("returns false for an unparsable expiration", () => {
    expect(isGracePeriodActive("not-a-date")).toBe(false);
  });

  test("respects an explicit `now` override", () => {
    const expiresAt = "2026-01-01T00:00:00.000Z";
    expect(isGracePeriodActive(expiresAt, Date.parse("2025-12-31T00:00:00.000Z"))).toBe(true);
    expect(isGracePeriodActive(expiresAt, Date.parse("2026-02-01T00:00:00.000Z"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// timingSafeEqualHex
// ---------------------------------------------------------------------------
describe("timingSafeEqualHex", () => {
  test("returns true for identical strings", () => {
    expect(timingSafeEqualHex("abc123", "abc123")).toBe(true);
  });

  test("returns false for different strings", () => {
    expect(timingSafeEqualHex("abc123", "abc124")).toBe(false);
  });

  test("returns false when either input is not a string", () => {
    expect(timingSafeEqualHex(null, "abc123")).toBe(false);
    expect(timingSafeEqualHex("abc123", undefined)).toBe(false);
    expect(timingSafeEqualHex(123, 123)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------
describe("verifyWebhookSignature", () => {
  const secret = "current-secret";
  const previousSecret = "previous-secret";
  const payload = JSON.stringify({ event: "milestone.reached", projectId: "p1" });

  test("returns true for a valid signature string", () => {
    const sig = generateSignature(secret, payload);
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
  });

  test("returns true when given an array of candidate signatures", () => {
    const sig = generateSignature(secret, payload);
    expect(verifyWebhookSignature(payload, ["bogus", sig], secret)).toBe(true);
  });

  test("returns true when given a headers object", () => {
    const sig = generateSignature(secret, payload);
    expect(verifyWebhookSignature(payload, { "x-webhook-signature": sig }, secret)).toBe(true);
  });

  test("returns false for an invalid signature", () => {
    expect(verifyWebhookSignature(payload, "not-the-right-signature", secret)).toBe(false);
  });

  test("returns false when signatureInput or currentSecret is missing", () => {
    expect(verifyWebhookSignature(payload, "", secret)).toBe(false);
    expect(verifyWebhookSignature(payload, "sig", "")).toBe(false);
  });

  test("accepts the previous secret's signature during an active grace period", () => {
    const prevSig = generateSignature(previousSecret, payload);
    const now = Date.now();
    const previousSecretExpiresAt = new Date(now + 60_000).toISOString();

    expect(
      verifyWebhookSignature(payload, prevSig, secret, {
        previousSecret,
        previousSecretExpiresAt,
        now,
      }),
    ).toBe(true);
  });

  test("rejects the previous secret's signature once the grace period has expired", () => {
    const prevSig = generateSignature(previousSecret, payload);
    const now = Date.now();
    const previousSecretExpiresAt = new Date(now - 60_000).toISOString();

    expect(
      verifyWebhookSignature(payload, prevSig, secret, {
        previousSecret,
        previousSecretExpiresAt,
        now,
      }),
    ).toBe(false);
  });

  test("accepts the dual-signature format sent by deliverPayload during the grace period", () => {
    const now = Date.now();
    const previousSecretExpiresAt = new Date(now + 60_000).toISOString();
    const currentSig = generateSignature(secret, payload);
    const prevSig = generateSignature(previousSecret, payload);
    const combined = `${currentSig}, ${prevSig}`;

    expect(
      verifyWebhookSignature(payload, combined, secret, {
        previousSecret,
        previousSecretExpiresAt,
        now,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deliverPayload
// ---------------------------------------------------------------------------
describe("deliverPayload", () => {
  let httpReqSpy;
  let httpsReqSpy;

  afterEach(() => {
    if (httpReqSpy) httpReqSpy.mockRestore();
    if (httpsReqSpy) httpsReqSpy.mockRestore();
    httpReqSpy = undefined;
    httpsReqSpy = undefined;
  });

  test("re-validates the URL via assertPublicHttpUrl and propagates a rejection without attempting delivery", async () => {
    const ssrfError = new Error("Blocked private/reserved IP: 127.0.0.1");
    assertPublicHttpUrl.mockRejectedValueOnce(ssrfError);
    httpsReqSpy = jest.spyOn(https, "request").mockImplementation(() => {
      throw new Error("https.request should not have been called");
    });

    await expect(
      deliverPayload("https://blocked.example.com/webhook", "secret", { projectId: "p1" }),
    ).rejects.toThrow("Blocked private/reserved IP");

    expect(assertPublicHttpUrl).toHaveBeenCalledWith("https://blocked.example.com/webhook");
    expect(httpsReqSpy).not.toHaveBeenCalled();
  });

  test("resolves with the response status code and signs with a single X-Webhook-Signature header", async () => {
    httpsReqSpy = mockRequestSuccess(https, 200);
    const secret = "s".repeat(32);
    const payload = { projectId: "p1", milestone: "M1" };

    const result = await deliverPayload("https://example.com/hooks/abc", secret, payload);

    expect(result).toEqual({ statusCode: 200 });
    const [options] = httpsReqSpy.mock.calls[0];
    expect(options.hostname).toBe("example.com");
    expect(options.port).toBe(443);
    expect(options.path).toBe("/hooks/abc");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["User-Agent"]).toBe("GreenPay-Webhook/1.0");
    expect(options.headers["X-Webhook-Signature"]).toBe(
      generateSignature(secret, JSON.stringify(payload)),
    );
    expect(options.headers["X-Webhook-Signature-Previous"]).toBeUndefined();
  });

  test("uses the http module for http:// URLs and the https module for https:// URLs", async () => {
    httpReqSpy = mockRequestSuccess(http, 200);
    await deliverPayload("http://example.com/hook", "secret", { projectId: "p1" });
    expect(httpReqSpy).toHaveBeenCalledTimes(1);
    expect(httpReqSpy.mock.calls[0][0].port).toBe(80);
  });

  test("signs with both the current and previous secret during an active grace period", async () => {
    httpsReqSpy = mockRequestSuccess(https, 200);
    const secret = "current-secret";
    const previousSecret = "previous-secret";
    const payload = { projectId: "p1" };
    const body = JSON.stringify(payload);
    const now = Date.now();
    const previousSecretExpiresAt = new Date(now + 60 * 60 * 1000).toISOString();

    await deliverPayload("https://example.com/hook", secret, payload, {
      previousSecret,
      previousSecretExpiresAt,
      now,
    });

    const [options] = httpsReqSpy.mock.calls[0];
    const expectedCurrentSig = generateSignature(secret, body);
    const expectedPrevSig = generateSignature(previousSecret, body);
    expect(options.headers["X-Webhook-Signature"]).toBe(`${expectedCurrentSig}, ${expectedPrevSig}`);
    expect(options.headers["X-Webhook-Signature-Previous"]).toBe(expectedPrevSig);
  });

  test("does not add previous-secret headers once the grace period has expired", async () => {
    httpsReqSpy = mockRequestSuccess(https, 200);
    const secret = "current-secret";
    const previousSecret = "previous-secret";
    const payload = { projectId: "p1" };
    const now = Date.now();
    const previousSecretExpiresAt = new Date(now - 1000).toISOString();

    await deliverPayload("https://example.com/hook", secret, payload, {
      previousSecret,
      previousSecretExpiresAt,
      now,
    });

    const [options] = httpsReqSpy.mock.calls[0];
    expect(options.headers["X-Webhook-Signature-Previous"]).toBeUndefined();
    expect(options.headers["X-Webhook-Signature"]).toBe(
      generateSignature(secret, JSON.stringify(payload)),
    );
  });

  test("rejects when the underlying request errors", async () => {
    const err = new Error("ECONNREFUSED");
    httpsReqSpy = mockRequestNetworkError(https, err);
    await expect(
      deliverPayload("https://example.com/hook", "secret", { projectId: "p1" }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  test("rejects and destroys the request on timeout", async () => {
    httpsReqSpy = mockRequestTimeout(https);
    await expect(
      deliverPayload("https://example.com/hook", "secret", { projectId: "p1" }),
    ).rejects.toThrow("Webhook request timed out");
    const req = httpsReqSpy.mock.results[0].value;
    expect(req.destroy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// recordAndDeliver
// ---------------------------------------------------------------------------
describe("recordAndDeliver", () => {
  let poolQuerySpy;
  let httpsReqSpy;

  beforeEach(() => {
    poolQuerySpy = jest.spyOn(pool, "query").mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    poolQuerySpy.mockRestore();
    if (httpsReqSpy) httpsReqSpy.mockRestore();
    httpsReqSpy = undefined;
  });

  test("persists a pending row, delivers successfully, and marks it delivered", async () => {
    httpsReqSpy = mockRequestSuccess(https, 200);

    await recordAndDeliver({
      projectId: "proj-1",
      url: "https://example.com/webhook",
      secret: "s".repeat(32),
      payload: { event: "milestone.reached", projectId: "proj-1", milestone: "50%" },
    });

    expect(poolQuerySpy).toHaveBeenCalledTimes(2);

    const [insertSql, insertParams] = poolQuerySpy.mock.calls[0];
    expect(insertSql).toMatch(/INSERT INTO webhook_deliveries/);
    expect(insertSql).toMatch(/'pending'/);
    expect(insertParams[1]).toBe("proj-1");
    expect(insertParams[2]).toBe("https://example.com/webhook");
    expect(insertParams[4]).toBe("milestone.reached");

    const [updateSql, updateParams] = poolQuerySpy.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE webhook_deliveries/);
    const [id, status, responseStatus, delivered, lastError] = updateParams;
    expect(id).toBe(insertParams[0]);
    expect(status).toBe("delivered");
    expect(responseStatus).toBe(200);
    expect(delivered).toBe(true);
    expect(lastError).toBeNull();
  });

  test("marks the row failed (without throwing) when the endpoint responds with a non-2xx status", async () => {
    httpsReqSpy = mockRequestSuccess(https, 500);

    await recordAndDeliver({
      projectId: "proj-1",
      url: "https://example.com/webhook",
      secret: "s".repeat(32),
      payload: { event: "milestone.reached", projectId: "proj-1" },
    });

    const [, updateParams] = poolQuerySpy.mock.calls[1];
    const [, status, responseStatus, delivered, lastError] = updateParams;
    expect(status).toBe("failed");
    expect(responseStatus).toBe(500);
    expect(delivered).toBe(false);
    expect(lastError).toBe("Webhook responded with HTTP 500");
  });

  test("marks the row failed and rethrows when the delivery request errors", async () => {
    const err = new Error("ECONNREFUSED");
    httpsReqSpy = mockRequestNetworkError(https, err);

    await expect(
      recordAndDeliver({
        projectId: "proj-1",
        url: "https://example.com/webhook",
        secret: "s".repeat(32),
        payload: { event: "milestone.reached", projectId: "proj-1" },
      }),
    ).rejects.toThrow("ECONNREFUSED");

    expect(poolQuerySpy).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = poolQuerySpy.mock.calls[1];
    expect(updateSql).toMatch(/status = 'failed'/);
    expect(updateParams[1]).toBe("ECONNREFUSED");
  });

  test("marks the row failed and rethrows when assertPublicHttpUrl rejects the URL", async () => {
    const ssrfError = new Error("Blocked private/reserved IP: 127.0.0.1");
    assertPublicHttpUrl.mockRejectedValueOnce(ssrfError);

    await expect(
      recordAndDeliver({
        projectId: "proj-1",
        url: "https://blocked.example.com/webhook",
        secret: "s".repeat(32),
        payload: { event: "milestone.reached", projectId: "proj-1" },
      }),
    ).rejects.toThrow("Blocked private/reserved IP");

    const [, updateParams] = poolQuerySpy.mock.calls[1];
    expect(updateParams[1]).toBe(ssrfError.message);
  });

  test("passes previousSecret/previousSecretExpiresAt through to deliverPayload's dual-signature signing", async () => {
    httpsReqSpy = mockRequestSuccess(https, 200);
    const secret = "current-secret-32-chars-long!!!";
    const previousSecret = "previous-secret-32-chars-long!!";
    const now = Date.now();

    await recordAndDeliver({
      projectId: "proj-1",
      url: "https://example.com/webhook",
      secret,
      payload: { event: "milestone.reached", projectId: "proj-1" },
      options: {
        previousSecret,
        previousSecretExpiresAt: new Date(now + 60_000).toISOString(),
      },
    });

    const [options] = httpsReqSpy.mock.calls[0];
    expect(options.headers["X-Webhook-Signature-Previous"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// rotateWebhookSecret
// ---------------------------------------------------------------------------
describe("rotateWebhookSecret", () => {
  let poolQuerySpy;

  afterEach(() => {
    if (poolQuerySpy) poolQuerySpy.mockRestore();
    poolQuerySpy = undefined;
  });

  test("throws a 404 error when the project does not exist", async () => {
    poolQuerySpy = jest.spyOn(pool, "query").mockResolvedValueOnce({ rows: [] });
    await expect(rotateWebhookSecret("missing-id")).rejects.toMatchObject({ status: 404 });
  });

  test("rotates the secret, preserves the old one as previous, and activates the grace period", async () => {
    const now = Date.now();
    const oldSecret = "whsec_old_secret";

    poolQuerySpy = jest
      .spyOn(pool, "query")
      .mockResolvedValueOnce({
        rows: [{ id: "proj-1", webhook_secret: oldSecret, previous_webhook_secret: null }],
      })
      .mockImplementationOnce((_sql, params) =>
        Promise.resolve({
          rows: [
            {
              id: "proj-1",
              webhook_secret: params[0],
              previous_webhook_secret: params[1],
              webhook_secret_rotated_at: params[2],
              previous_webhook_secret_expires_at: params[3],
            },
          ],
        }),
      );

    const result = await rotateWebhookSecret("proj-1", { now });

    expect(result.success).toBe(true);
    expect(result.webhookSecret).toMatch(/^whsec_/);
    expect(result.webhookSecret).not.toBe(oldSecret);
    expect(result.previousSecretExpiresAt).not.toBeNull();
    expect(result.gracePeriodActive).toBe(true);
  });

  test("does not activate a grace period when there was no previous secret to preserve", async () => {
    const now = Date.now();

    poolQuerySpy = jest
      .spyOn(pool, "query")
      .mockResolvedValueOnce({
        rows: [{ id: "proj-1", webhook_secret: null, previous_webhook_secret: null }],
      })
      .mockImplementationOnce((_sql, params) =>
        Promise.resolve({
          rows: [
            {
              id: "proj-1",
              webhook_secret: params[0],
              previous_webhook_secret: params[1],
              webhook_secret_rotated_at: params[2],
              previous_webhook_secret_expires_at: params[3],
            },
          ],
        }),
      );

    const result = await rotateWebhookSecret("proj-1", { now });

    expect(result.previousSecretExpiresAt).toBeNull();
    expect(result.gracePeriodActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: donation -> milestone -> webhook delivery pipeline
//
// Uses a real Postgres testcontainer plus a local HTTP capture server.
// Skipped gracefully (matching the convention used by
// `routes/donations.integration.test.js` and `services/profileQueue.test.js`)
// when Docker/testcontainers isn't available in the current environment.
// ---------------------------------------------------------------------------
describe("Webhook delivery integration (testcontainers)", () => {
  jest.setTimeout(120000);

  let container;
  let testPool;
  let serverContainerReady = false;

  beforeAll(async () => {
    if (process.env.SKIP_INTEGRATION === "1") {
      console.warn("Skipping integration tests (SKIP_INTEGRATION=1)");
      return;
    }

    try {
      // eslint-disable-next-line global-require
      const { GenericContainer, Wait } = require("testcontainers");
      // eslint-disable-next-line global-require
      const { Pool } = require("pg");

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

      // schema.sql doesn't include the secret-rotation columns added by
      // migrations/003_webhook_secret_rotation.js. checkAndDeliverMilestones
      // selects them from `projects`, so add them here directly.
      await testPool.query(`
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS previous_webhook_secret TEXT;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_secret_rotated_at TIMESTAMPTZ;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS previous_webhook_secret_expires_at TIMESTAMPTZ;
      `);

      process.env.DATABASE_URL = connectionString;
      delete require.cache[require.resolve("../db/pool")];
      delete require.cache[require.resolve("./webhook")];

      const appPool = require("../db/pool");
      await appPool.query("SELECT 1");

      serverContainerReady = true;
      console.log(`Testcontainers PostgreSQL ready at ${host}:${port}`);
    } catch (err) {
      console.warn("Testcontainers startup failed – integration tests will be skipped:", err.message);
      serverContainerReady = false;
      try {
        if (testPool) await testPool.end();
      } catch { /* best-effort cleanup */ }
      try {
        if (container) await container.stop();
      } catch { /* best-effort cleanup */ }
      container = null;
      testPool = null;
    }
  });

  afterAll(async () => {
    try {
      // eslint-disable-next-line global-require
      const appPool = require("../db/pool");
      await appPool.end();
    } catch { /* best-effort cleanup */ }
    try {
      if (testPool) await testPool.end();
    } catch { /* best-effort cleanup */ }
    try {
      if (container) await container.stop({ timeout: 5000 });
    } catch { /* best-effort cleanup */ }
  });

  /** Start a tiny HTTP server on a random port. Returns { port, server }. */
  function startCaptureServer() {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        resolve({ port: server.address().port, server });
      });
    });
  }

  function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
  }

  test("delivers signed milestone webhooks and persists a 'delivered' webhook_deliveries row", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await testPool.query("TRUNCATE projects, project_milestones, donations, webhook_deliveries RESTART IDENTITY CASCADE");

    // eslint-disable-next-line global-require
    const { checkAndDeliverMilestones } = require("./webhook");

    const { port, server } = await startCaptureServer();
    const webhookUrl = `http://127.0.0.1:${port}/webhook`;
    const webhookSecret = "whsec_supersecret_test_key_12345";

    const received = [];
    server.on("request", (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

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
        "100",
        "55",
        webhookUrl,
        webhookSecret,
      ],
    );

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
      ],
    );

    await checkAndDeliverMilestones(projectId);
    await new Promise((r) => setTimeout(r, 2000));
    await closeServer(server);

    expect(received.length).toBe(2);
    expect(received.every((r) => r.method === "POST" && r.url === "/webhook")).toBe(true);

    for (const req of received) {
      const sigHeader = req.headers["x-webhook-signature"];
      const expectedSig = crypto.createHmac("sha256", webhookSecret).update(req.body).digest("hex");
      expect(sigHeader).toBe(expectedSig);
      expect(req.headers["content-type"]).toBe("application/json");
      expect(req.headers["user-agent"]).toBe("GreenPay-Webhook/1.0");

      const payload = JSON.parse(req.body);
      expect(payload.event).toBe("milestone.reached");
      expect(payload.projectId).toBe(projectId);
      expect(payload.totalRaisedXLM).toBe("55.0000000");
      expect([25, 50]).toContain(payload.percentage);
    }

    const percentages = received.map((r) => JSON.parse(r.body).percentage);
    expect(percentages).not.toContain(75);

    const dbMilestones = await testPool.query(
      "SELECT id, percentage, reached_at FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [projectId],
    );
    expect(dbMilestones.rows).toHaveLength(3);
    expect(dbMilestones.rows[0].reached_at).not.toBeNull();
    expect(dbMilestones.rows[1].reached_at).not.toBeNull();
    expect(dbMilestones.rows[2].reached_at).toBeNull();

    // recordAndDeliver persists each delivery attempt to webhook_deliveries.
    const deliveryRows = await testPool.query(
      "SELECT status, response_status, event, delivered_at FROM webhook_deliveries WHERE project_id = $1 ORDER BY created_at ASC",
      [projectId],
    );
    expect(deliveryRows.rows).toHaveLength(2);
    for (const row of deliveryRows.rows) {
      expect(row.status).toBe("delivered");
      expect(row.response_status).toBe(200);
      expect(row.event).toBe("milestone.reached");
      expect(row.delivered_at).not.toBeNull();
    }
  });

  test("triggers milestone webhooks via a donation that pushes raised_xlm past a threshold", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await testPool.query("TRUNCATE projects, project_milestones, donations, webhook_deliveries RESTART IDENTITY CASCADE");

    // eslint-disable-next-line global-require
    const { checkAndDeliverMilestones } = require("./webhook");

    const { port, server } = await startCaptureServer();
    const webhookUrl = `http://127.0.0.1:${port}/webhook`;
    const webhookSecret = "whsec_donation_triggered_test_key";

    const received = [];
    server.on("request", (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    await testPool.query(
      `INSERT INTO projects (id, name, description, category, location, wallet_address, goal_xlm, raised_xlm, webhook_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        projectId,
        "Donation-Triggered Webhook Project",
        "Testing donation -> milestone -> webhook pipeline",
        "Solar Energy",
        "India",
        "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDY",
        "200",
        "0",
        webhookUrl,
        webhookSecret,
      ],
    );

    const milestone15Id = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const milestone30Id = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await testPool.query(
      `INSERT INTO project_milestones (id, project_id, percentage, title)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        milestone15Id, projectId, 15, "15% funded — first light",
        milestone30Id, projectId, 30, "30% funded — panels ordered",
      ],
    );

    const donorAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const donationAmount = 35; // 35 / 200 = 17.5% -> crosses the 15% milestone

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
      ],
    );

    await testPool.query(
      `UPDATE projects
       SET raised_xlm = raised_xlm + $1::numeric,
           donor_count = (SELECT COUNT(DISTINCT donor_address) FROM donations WHERE project_id = $2),
           updated_at = NOW()
       WHERE id = $2`,
      [donationAmount, projectId],
    );

    await checkAndDeliverMilestones(projectId);
    await new Promise((r) => setTimeout(r, 2000));
    await closeServer(server);

    expect(received.length).toBe(1);
    expect(received[0].method).toBe("POST");
    expect(received[0].url).toBe("/webhook");

    const sigHeader = received[0].headers["x-webhook-signature"];
    const expectedSig = crypto.createHmac("sha256", webhookSecret).update(received[0].body).digest("hex");
    expect(sigHeader).toBe(expectedSig);

    const payload = JSON.parse(received[0].body);
    expect(payload.event).toBe("milestone.reached");
    expect(payload.projectId).toBe(projectId);
    expect(payload.percentage).toBe(15);
    expect(payload.milestone).toBe("15% funded — first light");
    expect(payload.totalRaisedXLM).toBe("35.0000000");

    const dbMilestones = await testPool.query(
      "SELECT id, percentage, reached_at FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [projectId],
    );
    expect(dbMilestones.rows).toHaveLength(2);
    expect(dbMilestones.rows[0].reached_at).not.toBeNull();
    expect(dbMilestones.rows[1].reached_at).toBeNull();

    const deliveryRows = await testPool.query(
      "SELECT status, response_status, event FROM webhook_deliveries WHERE project_id = $1",
      [projectId],
    );
    expect(deliveryRows.rows).toHaveLength(1);
    expect(deliveryRows.rows[0].status).toBe("delivered");
    expect(deliveryRows.rows[0].response_status).toBe(200);
    expect(deliveryRows.rows[0].event).toBe("milestone.reached");
  });

  test("does not deliver or persist webhooks when the project has no webhook_url configured", async () => {
    if (!serverContainerReady) {
      console.warn("Skipping – testcontainer not available");
      return expect(true).toBe(true);
    }

    await testPool.query("TRUNCATE projects, project_milestones, webhook_deliveries RESTART IDENTITY CASCADE");

    // eslint-disable-next-line global-require
    const { checkAndDeliverMilestones } = require("./webhook");

    const { server } = await startCaptureServer();
    const received = [];
    server.on("request", (req, res) => {
      received.push({ url: req.url });
      res.writeHead(200);
      res.end();
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
        "60",
      ],
    );

    await testPool.query(
      `INSERT INTO project_milestones (id, project_id, percentage, title)
       VALUES ($1, $2, $3, $4)`,
      ["cccccccc-cccc-cccc-cccc-cccccccccccc", projectId, 50, "Halfway there"],
    );

    await checkAndDeliverMilestones(projectId);
    await new Promise((r) => setTimeout(r, 2000));
    await closeServer(server);

    expect(received.length).toBe(0);

    const deliveryRows = await testPool.query(
      "SELECT id FROM webhook_deliveries WHERE project_id = $1",
      [projectId],
    );
    expect(deliveryRows.rows).toHaveLength(0);
  });
});
