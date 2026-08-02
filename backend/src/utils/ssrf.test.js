"use strict";

jest.mock("dns", () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const dns = require("dns");
const { assertPublicHttpUrl, isPrivateOrReservedIp, SsrfValidationError } = require("./ssrf");

describe("isPrivateOrReservedIp", () => {
  test.each([
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    ["169.254.169.254", true], // cloud metadata IP
    ["10.0.0.5", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["0.0.0.0", true],
    ["100.64.0.1", true],
    ["::1", true],
    ["::", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["::ffff:127.0.0.1", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false],
    ["2606:4700:4700::1111", false],
  ])("%s -> blocked=%s", (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe("assertPublicHttpUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects http://localhost:8080/internal", async () => {
    await expect(assertPublicHttpUrl("http://localhost:8080/internal")).rejects.toThrow(
      SsrfValidationError,
    );
    expect(dns.promises.resolve4).not.toHaveBeenCalled();
  });

  test("rejects http://169.254.169.254/metadata", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/metadata")).rejects.toThrow(
      SsrfValidationError,
    );
    expect(dns.promises.resolve4).not.toHaveBeenCalled();
  });

  test("rejects loopback IP literal", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/x")).rejects.toThrow(SsrfValidationError);
  });

  test("rejects IPv6 loopback literal", async () => {
    await expect(assertPublicHttpUrl("http://[::1]/x")).rejects.toThrow(SsrfValidationError);
  });

  test("rejects RFC1918 ranges", async () => {
    await expect(assertPublicHttpUrl("http://10.1.2.3/")).rejects.toThrow(SsrfValidationError);
    await expect(assertPublicHttpUrl("http://172.16.5.5/")).rejects.toThrow(SsrfValidationError);
    await expect(assertPublicHttpUrl("http://192.168.0.1/")).rejects.toThrow(SsrfValidationError);
  });

  test("rejects IPv6 unique-local and link-local literals", async () => {
    await expect(assertPublicHttpUrl("http://[fc00::1]/")).rejects.toThrow(SsrfValidationError);
    await expect(assertPublicHttpUrl("http://[fe80::1]/")).rejects.toThrow(SsrfValidationError);
  });

  test("rejects IPv4-mapped IPv6 loopback", async () => {
    await expect(assertPublicHttpUrl("http://[::ffff:127.0.0.1]/")).rejects.toThrow(
      SsrfValidationError,
    );
  });

  test("rejects decimal IP obfuscation", async () => {
    await expect(assertPublicHttpUrl("http://2130706433/")).rejects.toThrow(SsrfValidationError);
  });

  test("rejects non-http(s) schemes", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(SsrfValidationError);
    await expect(assertPublicHttpUrl("javascript:alert(1)")).rejects.toThrow(SsrfValidationError);
  });

  test("rejects an invalid URL string", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(SsrfValidationError);
  });

  test("rejects a hostname that only resolves to blocked addresses", async () => {
    dns.promises.resolve4.mockResolvedValue(["169.254.169.254"]);
    dns.promises.resolve6.mockRejectedValue(new Error("ENODATA"));
    await expect(assertPublicHttpUrl("http://internal.example.com/")).rejects.toThrow(
      SsrfValidationError,
    );
  });

  test("rejects a hostname that fails to resolve entirely", async () => {
    dns.promises.resolve4.mockRejectedValue(new Error("ENOTFOUND"));
    dns.promises.resolve6.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHttpUrl("http://does-not-exist.invalid/")).rejects.toThrow(
      SsrfValidationError,
    );
  });

  test("accepts a hostname that resolves to a public IP (e.g. webhook.site)", async () => {
    dns.promises.resolve4.mockResolvedValue(["104.21.0.1"]);
    dns.promises.resolve6.mockRejectedValue(new Error("ENODATA"));
    await expect(assertPublicHttpUrl("https://webhook.site/xyz")).resolves.toBeUndefined();
  });

  test("accepts a public IP literal", async () => {
    await expect(assertPublicHttpUrl("https://8.8.8.8/")).resolves.toBeUndefined();
  });
});
