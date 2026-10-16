/**
 * src/middleware/ssrf.test.js
 * Unit tests for SSRF and Webhook URL validation.
 */
"use strict";

const { validateWebhookUrl, isPrivateTarget } = require("./ssrf");

describe("SSRF and Webhook URL Validation", () => {
  describe("validateWebhookUrl", () => {
    test("accepts valid public HTTPS URLs", () => {
      const result = validateWebhookUrl("https://example.com/api/webhook");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test("accepts public HTTPS URLs with custom port and search params", () => {
      const result = validateWebhookUrl(
        "https://api.github.com:8443/hooks/events?token=abc",
      );
      expect(result.valid).toBe(true);
    });

    test("rejects non-string or missing URLs", () => {
      expect(validateWebhookUrl("").valid).toBe(false);
      expect(validateWebhookUrl(null).valid).toBe(false);
      expect(validateWebhookUrl(undefined).valid).toBe(false);
    });

    test("rejects URLs exceeding 2000 characters", () => {
      const longUrl = "https://example.com/" + "a".repeat(2000);
      const result = validateWebhookUrl(longUrl);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/must not exceed 2000 characters/i);
    });

    test("rejects HTTP URLs", () => {
      const result = validateWebhookUrl("http://example.com/webhook");
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/must use HTTPS protocol/i);
    });

    test("rejects non-HTTPS protocols (ftp, file, gopher)", () => {
      expect(validateWebhookUrl("ftp://example.com/file").valid).toBe(false);
      expect(validateWebhookUrl("file:///etc/passwd").valid).toBe(false);
    });

    test("rejects loopback IPv4 addresses (127.0.0.1)", () => {
      const result = validateWebhookUrl("https://127.0.0.1/webhook");
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/internal or private IP/i);
    });

    test("rejects private IPv4 ranges (10.0.0.1, 172.16.0.1, 192.168.1.10)", () => {
      expect(validateWebhookUrl("https://10.0.0.1/webhook").valid).toBe(false);
      expect(validateWebhookUrl("https://172.16.0.5/webhook").valid).toBe(
        false,
      );
      expect(validateWebhookUrl("https://192.168.1.1/webhook").valid).toBe(
        false,
      );
    });

    test("rejects AWS metadata and link-local addresses (169.254.169.254)", () => {
      const result = validateWebhookUrl(
        "https://169.254.169.254/latest/meta-data/",
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/internal or private IP/i);
    });

    test("rejects IPv6 loopback and private addresses (::1, fe80::1)", () => {
      expect(validateWebhookUrl("https://[::1]/webhook").valid).toBe(false);
      expect(validateWebhookUrl("https://[fe80::1]/webhook").valid).toBe(false);
    });

    test("rejects local hostnames (localhost, *.local, *.internal)", () => {
      expect(validateWebhookUrl("https://localhost/webhook").valid).toBe(false);
      expect(validateWebhookUrl("https://app.local/webhook").valid).toBe(false);
      expect(validateWebhookUrl("https://service.internal/webhook").valid).toBe(
        false,
      );
    });
  });

  describe("isPrivateTarget", () => {
    test("detects decimal and hex IPv4 obfuscation", () => {
      expect(isPrivateTarget("2130706433")).toBe(true); // 127.0.0.1
      expect(isPrivateTarget("0x7f000001")).toBe(true); // 127.0.0.1
      expect(isPrivateTarget("0177.0.0.1")).toBe(true); // octal 127.0.0.1
    });

    test("detects shortened dotted IPv4 notation (127.1, 10.1, 172.16.1, 192.168.1)", () => {
      expect(isPrivateTarget("127.1")).toBe(true);
      expect(isPrivateTarget("10.1")).toBe(true);
      expect(isPrivateTarget("172.16.1")).toBe(true);
      expect(isPrivateTarget("192.168.1")).toBe(true);
    });
  });
});
