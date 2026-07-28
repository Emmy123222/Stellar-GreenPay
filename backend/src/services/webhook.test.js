"use strict";

const pool = require("../db/pool");
const logger = require("../logger");
const http = require("http");
const {
  GRACE_PERIOD_MS,
  generateSignature,
  isGracePeriodActive,
  timingSafeEqualHex,
  verifyWebhookSignature,
  deliverPayload,
  rotateWebhookSecret,
  checkAndDeliverMilestones,
} = require("./webhook");

jest.mock("../db/pool");
jest.mock("../logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

describe("Webhook Secret Rotation and Delivery Service", () => {
  const projectId = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
  const initialSecret = "whsec_old_secret_123456789";
  const newSecret = "whsec_new_secret_987654321";
  const currentSecret = "whsec_current";
  const previousSecret = "whsec_previous";
  const payload = { event: "milestone.reached", milestone: "50% Funded" };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("timingSafeEqualHex", () => {
    test("returns true for identical strings", () => {
      expect(timingSafeEqualHex("abc123def", "abc123def")).toBe(true);
    });

    test("returns false for different strings of same length", () => {
      expect(timingSafeEqualHex("abc123def", "abc123deg")).toBe(false);
    });

    test("returns false for different strings of different lengths", () => {
      expect(timingSafeEqualHex("abc123def", "abc123defg")).toBe(false);
    });

    test("returns false for non-string inputs", () => {
      expect(timingSafeEqualHex(null, "abc")).toBe(false);
      expect(timingSafeEqualHex("abc", undefined)).toBe(false);
    });
  });

  describe("isGracePeriodActive", () => {
    test("returns true when current time is before expiration timestamp", () => {
      const now = new Date("2026-07-28T12:00:00Z").getTime();
      const expiresAt = "2026-07-29T12:00:00Z";
      expect(isGracePeriodActive(expiresAt, now)).toBe(true);
    });

    test("returns false when current time is after expiration timestamp", () => {
      const now = new Date("2026-07-29T12:00:01Z").getTime();
      const expiresAt = "2026-07-29T12:00:00Z";
      expect(isGracePeriodActive(expiresAt, now)).toBe(false);
    });

    test("returns false at exactly 24 hours boundary (equal timestamps)", () => {
      const now = new Date("2026-07-29T12:00:00Z").getTime();
      const expiresAt = "2026-07-29T12:00:00Z";
      expect(isGracePeriodActive(expiresAt, now)).toBe(false);
    });

    test("returns false when previousSecretExpiresAt is null or invalid", () => {
      expect(isGracePeriodActive(null)).toBe(false);
      expect(isGracePeriodActive("invalid-date")).toBe(false);
    });
  });

  describe("verifyWebhookSignature", () => {
    const now = new Date("2026-07-28T12:00:00Z").getTime();
    const futureExpiresAt = new Date(now + 3600 * 1000).toISOString();
    const pastExpiresAt = new Date(now - 3600 * 1000).toISOString();

    test("accepts signature generated with current secret immediately", () => {
      const sig = generateSignature(currentSecret, payload);
      expect(verifyWebhookSignature(payload, sig, currentSecret)).toBe(true);
    });

    test("accepts signature generated with old secret during active grace period", () => {
      const sigPrev = generateSignature(previousSecret, payload);
      expect(
        verifyWebhookSignature(payload, sigPrev, currentSecret, {
          previousSecret,
          previousSecretExpiresAt: futureExpiresAt,
          now,
        })
      ).toBe(true);
    });

    test("rejects signature generated with old secret after grace period expiration", () => {
      const sigPrev = generateSignature(previousSecret, payload);
      expect(
        verifyWebhookSignature(payload, sigPrev, currentSecret, {
          previousSecret,
          previousSecretExpiresAt: pastExpiresAt,
          now,
        })
      ).toBe(false);
    });

    test("rejects completely invalid signatures", () => {
      expect(verifyWebhookSignature(payload, "invalid_sig_12345", currentSecret)).toBe(false);
    });

    test("handles comma-separated dual signature headers", () => {
      const sigCurrent = generateSignature(currentSecret, payload);
      const sigPrev = generateSignature(previousSecret, payload);
      const combinedHeader = `${sigCurrent}, ${sigPrev}`;

      expect(
        verifyWebhookSignature(payload, combinedHeader, currentSecret, {
          previousSecret,
          previousSecretExpiresAt: futureExpiresAt,
          now,
        })
      ).toBe(true);
    });

    test("handles headers object with X-Webhook-Signature and X-Webhook-Signature-Previous", () => {
      const sigPrev = generateSignature(previousSecret, payload);
      const headers = {
        "x-webhook-signature": "bogus",
        "x-webhook-signature-previous": sigPrev,
      };

      expect(
        verifyWebhookSignature(payload, headers, currentSecret, {
          previousSecret,
          previousSecretExpiresAt: futureExpiresAt,
          now,
        })
      ).toBe(true);
    });

    test("returns false when currentSecret is missing or invalid", () => {
      expect(verifyWebhookSignature(payload, "sig", null)).toBe(false);
    });
  });

  describe("rotateWebhookSecret", () => {
    const fixedNow = new Date("2026-07-28T16:00:00Z").getTime();

    test("successfully rotates secret, preserves old secret, and sets 24h expiration timestamp", async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: projectId, webhook_secret: initialSecret, previous_webhook_secret: null }],
        })
        .mockImplementationOnce((query, values) => {
          return Promise.resolve({
            rows: [
              {
                id: values[4],
                webhook_secret: values[0],
                previous_webhook_secret: values[1],
                webhook_secret_rotated_at: values[2],
                previous_webhook_secret_expires_at: values[3],
              },
            ],
          });
        });

      const result = await rotateWebhookSecret(projectId, { now: fixedNow });

      expect(result.success).toBe(true);
      expect(result.projectId).toBe(projectId);
      expect(result.webhookSecret).toMatch(/^whsec_[a-f0-9]{48}$/);
      expect(result.rotatedAt).toBe(new Date(fixedNow).toISOString());
      expect(result.previousSecretExpiresAt).toBe(new Date(fixedNow + GRACE_PERIOD_MS).toISOString());
      expect(result.gracePeriodActive).toBe(true);

      // Ensure previous secret value is preserved in database call
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE projects"),
        expect.arrayContaining([expect.stringMatching(/^whsec_/), initialSecret, expect.any(String), expect.any(String), projectId])
      );
    });

    test("handles rotation when project had no prior webhook_secret", async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: projectId, webhook_secret: null, previous_webhook_secret: null }],
        })
        .mockImplementationOnce((query, values) => {
          return Promise.resolve({
            rows: [
              {
                id: values[4],
                webhook_secret: values[0],
                previous_webhook_secret: values[1],
                webhook_secret_rotated_at: values[2],
                previous_webhook_secret_expires_at: values[3],
              },
            ],
          });
        });

      const result = await rotateWebhookSecret(projectId, { now: fixedNow });

      expect(result.success).toBe(true);
      expect(result.previousSecretExpiresAt).toBeNull();
      expect(result.gracePeriodActive).toBe(false);
    });

    test("handles multiple consecutive rotations while grace period is active", async () => {
      const activeGraceExpiresAt = new Date(fixedNow + 10000).toISOString();
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: projectId,
              webhook_secret: newSecret,
              previous_webhook_secret: initialSecret,
              previous_webhook_secret_expires_at: activeGraceExpiresAt,
            },
          ],
        })
        .mockImplementationOnce((query, values) => {
          return Promise.resolve({
            rows: [
              {
                id: values[4],
                webhook_secret: values[0],
                previous_webhook_secret: values[1],
                webhook_secret_rotated_at: values[2],
                previous_webhook_secret_expires_at: values[3],
              },
            ],
          });
        });

      const newRotationNow = fixedNow + 3600 * 1000;
      const result = await rotateWebhookSecret(projectId, { now: newRotationNow });

      expect(result.success).toBe(true);
      // Secret prior to this second rotation (newSecret) becomes the previous secret
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("UPDATE projects"),
        expect.arrayContaining([expect.stringMatching(/^whsec_/), newSecret, expect.any(String), expect.any(String), projectId])
      );
      expect(result.previousSecretExpiresAt).toBe(new Date(newRotationNow + GRACE_PERIOD_MS).toISOString());
    });

    test("throws 404 error if project is not found", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(rotateWebhookSecret("non-existent-id")).rejects.toThrow("Project not found");
    });
  });

  describe("deliverPayload HTTP Dual-Signature Delivery", () => {
    let server;
    let receivedHeaders;
    let receivedBody;
    let port;

    beforeEach((done) => {
      receivedHeaders = null;
      receivedBody = null;
      server = http.createServer((req, res) => {
        receivedHeaders = req.headers;
        let data = "";
        req.on("data", (chunk) => {
          data += chunk;
        });
        req.on("end", () => {
          receivedBody = data;
          res.statusCode = 200;
          res.end("OK");
        });
      });
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        done();
      });
    });

    afterEach((done) => {
      server.close(done);
    });

    test("signs delivery with single signature when not in grace period", (done) => {
      const url = `http://127.0.0.1:${port}/webhook`;
      deliverPayload(url, currentSecret, payload);

      setTimeout(() => {
        expect(receivedHeaders).toBeDefined();
        const sig = generateSignature(currentSecret, JSON.stringify(payload));
        expect(receivedHeaders["x-webhook-signature"]).toBe(sig);
        expect(receivedHeaders["x-webhook-signature-previous"]).toBeUndefined();
        done();
      }, 100);
    });

    test("signs delivery with dual signatures during grace period", (done) => {
      const url = `http://127.0.0.1:${port}/webhook`;
      const now = Date.now();
      const futureExpiresAt = new Date(now + 3600 * 1000).toISOString();

      deliverPayload(url, currentSecret, payload, {
        previousSecret,
        previousSecretExpiresAt: futureExpiresAt,
        now,
      });

      setTimeout(() => {
        expect(receivedHeaders).toBeDefined();
        const currentSig = generateSignature(currentSecret, JSON.stringify(payload));
        const prevSig = generateSignature(previousSecret, JSON.stringify(payload));

        expect(receivedHeaders["x-webhook-signature-previous"]).toBe(prevSig);
        expect(receivedHeaders["x-webhook-signature"]).toBe(`${currentSig}, ${prevSig}`);
        done();
      }, 100);
    });

    test("signs delivery with single signature after grace period expires", (done) => {
      const url = `http://127.0.0.1:${port}/webhook`;
      const now = Date.now();
      const pastExpiresAt = new Date(now - 3600 * 1000).toISOString();

      deliverPayload(url, currentSecret, payload, {
        previousSecret,
        previousSecretExpiresAt: pastExpiresAt,
        now,
      });

      setTimeout(() => {
        expect(receivedHeaders).toBeDefined();
        const currentSig = generateSignature(currentSecret, JSON.stringify(payload));

        expect(receivedHeaders["x-webhook-signature"]).toBe(currentSig);
        expect(receivedHeaders["x-webhook-signature-previous"]).toBeUndefined();
        done();
      }, 100);
    });
  });
});
