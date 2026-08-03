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
const net = require("net");
const {
  validateUrl,
  checkPrivateIPv4,
  checkPrivateIPv6,
  normalizeIPv6,
  ip4ToInt,
  stripBrackets,
} = require("./webhook");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Create a canned `dns.lookup` response for a list of IP addresses. */
function mockDnsResponse(addresses) {
  return jest.spyOn(dns, "lookup").mockImplementation((hostname, opts, cb) => {
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }
    const results = addresses.map((addr) => ({
      address: addr,
      family: net.isIPv4(addr) ? 4 : 6,
    }));
    if (results.length === 1 && !opts.all) {
      cb(null, results[0].address, results[0].family);
    } else {
      cb(null, results);
    }
  });
}

// ---------------------------------------------------------------------------
// stripBrackets
// ---------------------------------------------------------------------------
describe("stripBrackets", () => {
  test("strips brackets from IPv6 address", () => {
    expect(stripBrackets("[::1]")).toBe("::1");
    expect(stripBrackets("[fc00::1]")).toBe("fc00::1");
  });

  test("returns unchanged if no brackets", () => {
    expect(stripBrackets("::1")).toBe("::1");
    expect(stripBrackets("example.com")).toBe("example.com");
    expect(stripBrackets("192.168.1.1")).toBe("192.168.1.1");
  });

  test("handles empty string", () => {
    expect(stripBrackets("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// ip4ToInt
// ---------------------------------------------------------------------------
describe("ip4ToInt", () => {
  test("converts a dotted-quad to a 32-bit integer", () => {
    expect(ip4ToInt("0.0.0.0")).toBe(0);
    expect(ip4ToInt("255.255.255.255")).toBe(4294967295);
    expect(ip4ToInt("127.0.0.1")).toBe(2130706433);
    expect(ip4ToInt("192.168.1.1")).toBe(3232235777);
  });
});

// ---------------------------------------------------------------------------
// checkPrivateIPv4
// ---------------------------------------------------------------------------
describe("checkPrivateIPv4", () => {
  const privateCases = [
    ["127.0.0.1", "127.0.0.0/8"],
    ["127.255.255.255", "127.0.0.0/8"],
    ["10.0.0.1", "10.0.0.0/8"],
    ["10.255.255.255", "10.0.0.0/8"],
    ["172.16.0.1", "172.16.0.0/12"],
    ["172.31.255.255", "172.16.0.0/12"],
    ["192.168.0.1", "192.168.0.0/16"],
    ["192.168.255.255", "192.168.0.0/16"],
    ["169.254.1.1", "169.254.0.0/16"],
    ["0.0.0.0", "0.0.0.0/8"],
    ["0.255.255.255", "0.0.0.0/8"],
    ["203.0.113.1", "203.0.113.0/24"],
    ["198.51.100.1", "198.51.100.0/24"],
    ["192.0.2.1", "192.0.2.0/24"],
  ];

  test.each(privateCases)(
    "detects %s as private (%s)",
    (ip, expectedRange) => {
      const result = checkPrivateIPv4(ip);
      expect(result.blocked).toBe(true);
      expect(result.range).toBe(expectedRange);
    },
  );

  const publicCases = ["8.8.8.8", "1.1.1.1", "142.250.80.46", "93.184.216.34"];

  test.each(publicCases)("allows public IPv4 %s", (ip) => {
    expect(checkPrivateIPv4(ip).blocked).toBe(false);
  });

  test("returns { blocked: false } for non-IPv4 strings", () => {
    expect(checkPrivateIPv4("not-an-ip").blocked).toBe(false);
    expect(checkPrivateIPv4("::1").blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeIPv6
// ---------------------------------------------------------------------------
describe("normalizeIPv6", () => {
  test("normalises ::1 to full form", () => {
    expect(normalizeIPv6("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });

  test("normalises [::1] (bracketed) to full form", () => {
    expect(normalizeIPv6("[::1]")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });

  test("normalises :: (unspecified)", () => {
    expect(normalizeIPv6("::")).toBe("0000:0000:0000:0000:0000:0000:0000:0000");
  });

  test("normalises fc00::", () => {
    expect(normalizeIPv6("fc00::")).toBe("fc00:0000:0000:0000:0000:0000:0000:0000");
  });

  test("normalises fe80::1", () => {
    expect(normalizeIPv6("fe80::1")).toBe("fe80:0000:0000:0000:0000:0000:0000:0001");
  });

  test("normalises 2001:db8::1", () => {
    expect(normalizeIPv6("2001:db8::1")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
  });

  test("normalises upper-case to lower-case", () => {
    expect(normalizeIPv6("FD00::1")).toBe("fd00:0000:0000:0000:0000:0000:0000:0001");
  });

  test("handles full form without compression", () => {
    expect(normalizeIPv6("fd12:3456:789a:0000:0000:0000:0000:0001")).toBe(
      "fd12:3456:789a:0000:0000:0000:0000:0001",
    );
  });

  test("returns null for non-IPv6", () => {
    expect(normalizeIPv6("8.8.8.8")).toBeNull();
    expect(normalizeIPv6("not-an-ip")).toBeNull();
    expect(normalizeIPv6("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkPrivateIPv6
// ---------------------------------------------------------------------------
describe("checkPrivateIPv6", () => {
  const privateCases = [
    "::1",
    "0:0:0:0:0:0:0:1",
    "[::1]",
    "[fc00::1]",
    "fc00::",
    "fc00::1",
    "fd12:3456:789a:bcde::1",
    "fe80::1",
    "feb0::abcd",
    "FD00::1",
  ];

  test.each(privateCases)("detects %s as private IPv6", (ip) => {
    const result = checkPrivateIPv6(ip);
    expect(result.blocked).toBe(true);
    expect(result.range).toBeDefined();
  });

  const publicCases = [
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "2a00:1450:4001:82c::200e",
    "2001:db8::1",
  ];

  test.each(publicCases)("allows public IPv6 %s", (ip) => {
    expect(checkPrivateIPv6(ip).blocked).toBe(false);
  });

  test("returns { blocked: false } for non-IPv6 strings", () => {
    expect(checkPrivateIPv6("8.8.8.8").blocked).toBe(false);
    expect(checkPrivateIPv6("not-an-ip").blocked).toBe(false);
  });

  // --- IPv4-mapped IPv6 ---
  describe("IPv4-mapped IPv6 addresses", () => {
    const privateMapped = [
      ["::ffff:127.0.0.1", "127.0.0.0/8"],
      ["::ffff:10.0.0.1", "10.0.0.0/8"],
      ["::ffff:192.168.1.1", "192.168.0.0/16"],
      ["::ffff:169.254.169.254", "169.254.0.0/16"],
      ["::ffff:0:192.168.1.1", "192.168.0.0/16"],
      ["::FFFF:10.0.0.1", "10.0.0.0/8"],
    ];

    test.each(privateMapped)(
      "detects %s as private via embedded IPv4 (%s)",
      (ip, expectedRange) => {
        const result = checkPrivateIPv6(ip);
        expect(result.blocked).toBe(true);
        expect(result.range).toBe(expectedRange);
      },
    );

    const publicMapped = [
      "::ffff:8.8.8.8",
      "::ffff:1.1.1.1",
    ];

    test.each(publicMapped)("allows public mapped IPv6 %s", (ip) => {
      expect(checkPrivateIPv6(ip).blocked).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// validateUrl — static checks (no DNS needed)
// ---------------------------------------------------------------------------
describe("validateUrl — static checks", () => {
  beforeEach(() => {
    jest.spyOn(dns, "lookup").mockImplementation(() => {
      throw new Error("DNS should not be called for static checks");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects malformed URL", async () => {
    await expect(validateUrl("not-a-url")).rejects.toThrow("Invalid webhook URL");
  });

  test("rejects unsupported protocol (ftp)", async () => {
    await expect(
      validateUrl("ftp://example.com/hook"),
    ).rejects.toThrow(/unsupported protocol/);
  });

  test.each([
    "http://localhost:3000/hook",
    "http://127.0.0.1:8080/hook",
    "http://0.0.0.0/hook",
    "http://169.254.169.254/latest/meta-data",
  ])("rejects blocked hostname URL %s", async (url) => {
    await expect(validateUrl(url)).rejects.toThrow(
      /blocked hostname|private IPv4/,
    );
  });

  test.each([
    "http://10.0.0.1:8080/hook",
    "http://192.168.1.1/hook",
    "http://172.16.0.5/hook",
  ])("rejects private IPv4 URL %s", async (url) => {
    await expect(validateUrl(url)).rejects.toThrow(/private IPv4/);
  });

  test("rejects private IPv6 hostname in URL", async () => {
    await expect(
      validateUrl("http://[::1]:8080/hook"),
    ).rejects.toThrow(/blocked hostname|private IPv6/);
    await expect(
      validateUrl("http://[fc00::1]/hook"),
    ).rejects.toThrow(/private IPv6/);
  });

  test("rejects IPv4-mapped IPv6 addresses statically", async () => {
    await expect(
      validateUrl("http://[::ffff:192.168.1.1]/hook"),
    ).rejects.toThrow(/private IPv6|blocked/);
  });

  test("rejects empty URL", async () => {
    await expect(validateUrl("")).rejects.toThrow("Invalid webhook URL");
  });

  test("rejects URL with only protocol", async () => {
    await expect(validateUrl("http://")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateUrl — DNS resolution (mocked)
// ---------------------------------------------------------------------------
describe("validateUrl — DNS resolution (mocked)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("allows hostname that resolves to a public IP", async () => {
    mockDnsResponse(["1.1.1.1"]);
    await expect(
      validateUrl("https://example.com/webhook"),
    ).resolves.not.toThrow();
  });

  test("rejects hostname that resolves to a private IPv4", async () => {
    mockDnsResponse(["127.0.0.1"]);
    await expect(
      validateUrl("https://evil-internal.com/hook"),
    ).rejects.toThrow(/private IPv4|127\.0\.0\.0\/8/);
  });

  test("rejects hostname that resolves to a private IPv6", async () => {
    mockDnsResponse(["fc00::1"]);
    await expect(
      validateUrl("https://evil-internal-v6.com/hook"),
    ).rejects.toThrow(/private IPv6|fc00::\/7/);
  });

  test("rejects hostname that resolves to link-local IPv6", async () => {
    mockDnsResponse(["fe80::1"]);
    await expect(
      validateUrl("https://link-local-v6.com/hook"),
    ).rejects.toThrow(/private IPv6|fe80::\/10/);
  });

  test("rejects hostname when any resolved IP is private", async () => {
    mockDnsResponse(["1.1.1.1", "10.0.0.1", "8.8.8.8"]);
    await expect(
      validateUrl("https://multi-ip.com/hook"),
    ).rejects.toThrow(/private IPv4|10\.0\.0\.0\/8/);
  });

  test("rejects hostname that resolves to IPv4-mapped private IPv6", async () => {
    mockDnsResponse(["::ffff:192.168.1.1"]);
    await expect(
      validateUrl("https://mapped-private.com/hook"),
    ).rejects.toThrow(/private/);
  });

  test("allows hostname that resolves to IPv4-mapped public IPv6", async () => {
    mockDnsResponse(["::ffff:8.8.8.8"]);
    await expect(
      validateUrl("https://mapped-public.com/hook"),
    ).resolves.not.toThrow();
  });

  test("rejects unresolved hostname", async () => {
    jest.spyOn(dns, "lookup").mockImplementation((hostname, opts, cb) => {
      if (typeof opts === "function") cb = opts;
      const err = new Error("queryA ENOTFOUND example.com");
      err.code = "ENOTFOUND";
      cb(err);
    });
    await expect(
      validateUrl("http://nonexistent-domain-hopefully.com/hook"),
    ).rejects.toThrow(/DNS resolution failed/);
  });

  test("rejects AAAA-only hostname that resolves to private IPv6", async () => {
    jest.spyOn(dns, "lookup").mockImplementation((_hostname, _opts, cb) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      callback(null, [{ address: "fc00::1", family: 6 }]);
    });
    await expect(
      validateUrl("https://ipv6-only-private.com/hook"),
    ).rejects.toThrow(/private IPv6|fc00::\/7/);
  });
});

// ---------------------------------------------------------------------------
// validateUrl — edge cases (mocked)
// ---------------------------------------------------------------------------
describe("validateUrl — edge cases (mocked)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("allows HTTPS URLs that resolve to public IP", async () => {
    mockDnsResponse(["151.101.1.140"]);
    await expect(
      validateUrl("https://hooks.slack.com/services/T00/B00/xxxxx"),
    ).resolves.not.toThrow();
  });

  test("allows URL with embedded credentials when host resolves to public IP", async () => {
    jest.spyOn(dns, "lookup").mockImplementation((hostname, _opts, cb) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      if (hostname === "evil.com") {
        callback(null, [{ address: "8.8.8.8", family: 4 }]);
      } else {
        callback(new Error("ENOTFOUND"));
      }
    });
    await expect(
      validateUrl("http://user:pass@evil.com/hook"),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Smoke test with real DNS (can be skipped in CI)
// ---------------------------------------------------------------------------
describe("validateUrl — real DNS smoke test", () => {
  test("allows a well-known public hostname via real DNS", async () => {
    await expect(
      validateUrl("https://one.one.one.one/hook"),
    ).resolves.not.toThrow();
  }, 15000);
});
