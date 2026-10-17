"use strict";

jest.mock("dns", () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const dns = require("dns");
const {
  assertPublicHttpUrl,
  isPrivateOrReservedIp,
  isPrivateIp,
  isPrivateTarget,
  isUrlSafeFromSsrf,
  validateWebhookUrl,
  SsrfValidationError,
} = require("./ssrf");

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

describe("validateWebhookUrl / isPrivateTarget (sync webhook validation)", () => {
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

describe("isPrivateIp / isUrlSafeFromSsrf", () => {
  test.each([
    ["::1"],
    ["::"],
    ["fe80::1"],
    ["febf::ffff"],
    ["fc00::1"],
    ["fdff::1"],
    ["::ffff:127.0.0.1"],
    ["::ffff:8.8.8.8"],
  ])("blocks %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  test.each([["2606:4700:4700::1111"], ["2001:4860:4860::8888"]])(
    "allows public %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    }
  );

  test("isUrlSafeFromSsrf rejects blocked IPv6 literals", async () => {
    await expect(isUrlSafeFromSsrf("http://[::1]/")).resolves.toBe(false);
    await expect(isUrlSafeFromSsrf("http://[fe80::1]/")).resolves.toBe(false);
    await expect(isUrlSafeFromSsrf("http://[fc00::1]/")).resolves.toBe(false);
  });

  test("isUrlSafeFromSsrf allows public IPv6 literals", async () => {
    await expect(
      isUrlSafeFromSsrf("http://[2606:4700:4700::1111]/")
    ).resolves.toBe(true);
  });

  // URL serializes IPv6 hosts with brackets ("[::1]"), which net.isIP rejects
  // and getaddrinfo only tolerates on glibc. If the brackets leak into
  // dns.lookup the verdict becomes platform-dependent: public IPv6 literals are
  // rejected under musl (the node:20-alpine CI image). Assert literals never
  // reach the resolver.
  test("classifies IPv6 literals without consulting DNS", async () => {
    dns.promises.resolve4.mockRejectedValue(new Error("resolver should not be called"));
    dns.promises.resolve6.mockRejectedValue(new Error("resolver should not be called"));
    try {
      await expect(isUrlSafeFromSsrf("http://[2606:4700:4700::1111]/")).resolves.toBe(true);
      await expect(isUrlSafeFromSsrf("http://[fe80::1]/")).resolves.toBe(false);
      await expect(isUrlSafeFromSsrf("http://[fc00::1]/")).resolves.toBe(false);
      expect(dns.promises.resolve4).not.toHaveBeenCalled();
      expect(dns.promises.resolve6).not.toHaveBeenCalled();
    } finally {
      jest.clearAllMocks();
    }
  });
});
