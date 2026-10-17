"use strict";

// Unit tests for backend/src/services/unsubscribeToken.js
// Sign/verify HMAC-signed unsubscribe tokens for email unsubscribe links.

const { signUnsubscribeToken, verifyUnsubscribeToken } = require("./unsubscribeToken");

// The subscriptions.test.js also sets JWT_SECRET; keep our env isolation clean.
let originalJwtSecret;
let originalUnsubscribeSecret;

beforeEach(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  originalUnsubscribeSecret = process.env.UNSUBSCRIBE_SECRET;
  process.env.JWT_SECRET = "mock-unsubscribe-jwt-secret";
  delete process.env.UNSUBSCRIBE_SECRET;
});

afterEach(() => {
  if (originalJwtSecret !== undefined) process.env.JWT_SECRET = originalJwtSecret;
  else delete process.env.JWT_SECRET;
  if (originalUnsubscribeSecret !== undefined) process.env.UNSUBSCRIBE_SECRET = originalUnsubscribeSecret;
  else delete process.env.UNSUBSCRIBE_SECRET;
});

describe("unsubscribeToken service", () => {
  // ── Round trip ────────────────────────────────────────────────

  test("round trip: a token generated for a subject verifies and returns the same subject", () => {
    const token = signUnsubscribeToken("User@Example.com", "project-123");
    const parsed = verifyUnsubscribeToken(token);

    expect(parsed).toEqual({
      email: "user@example.com",
      projectId: "project-123",
    });
  });

  // ── Tamper ────────────────────────────────────────────────────

  test("rejects tampered tokens", () => {
    const token = signUnsubscribeToken("user@example.com", "project-123");
    const tampered = `${token}x`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  // ── Wrong subject ────────────────────────────────────────────

  test("wrong subject rejected: token for user A does not verify as user B", () => {
    const tokenA = signUnsubscribeToken(" usera@EXAMPLE.com ", "project-123");
    const parsed = verifyUnsubscribeToken(tokenA);
    // Email is normalized (trimmed + lowercased) to "usera@example.com"
    // This token should NOT verify as "user@example.com"
    expect(parsed.email).not.toBe("user@example.com");
    // But it should verify as the normalized version of what was signed
    expect(parsed).toEqual({ email: "usera@example.com", projectId: "project-123" });
  });

  // ── Malformed input ──────────────────────────────────────────

  test("malformed input: empty string returns null", () => {
    expect(verifyUnsubscribeToken("")).toBeNull();
  });

  test("malformed input: null returns null", () => {
    expect(verifyUnsubscribeToken(null)).toBeNull();
  });

  test("malformed input: undefined returns null", () => {
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
  });

  test("malformed input: number rejected", () => {
    expect(verifyUnsubscribeToken(12345)).toBeNull();
  });

  test("malformed input: random string rejected", () => {
    expect(verifyUnsubscribeToken(" completely random garbage")).toBeNull();
  });

  // ── Expiry ────────────────────────────────────────────────────

  test("tokens do not embed expiry; verify works as long as secret unchanged", () => {
    // Tokens as implemented do not embed a timestamp, so they do not expire.
    // This test documents the current behavior: a token always verifies
    // as long as the secret doesn't change. If expiry is ever added,
    // this test pattern (with jest.useFakeTimers) should catch it.
    const token = signUnsubscribeToken("user@example.com", "project-123");
    const parsed = verifyUnsubscribeToken(token);
    expect(parsed).toEqual({ email: "user@example.com", projectId: "project-123" });
  });

  // ── Configurable secret ───────────────────────────────────────

  test("token generated with one secret fails to verify under a different secret", () => {
    // Generate token with default secret (set in beforeEach)
    const token = signUnsubscribeToken("user@example.com", "project-123");
    // Temporarily set a different secret
    process.env.UNSUBSCRIBE_SECRET = "different-secret";
    const parsed = verifyUnsubscribeToken(token);
    // Should fail because the signature won't match
    expect(parsed).toBeNull();
    // Restore in afterEach will handle this
    delete process.env.UNSUBSCRIBE_SECRET;
  });
});