"use strict";

const dns = require("dns");
const { isPrivateIp, isUrlSafeFromSsrf } = require("./ssrfCheck");

describe("ssrfCheck IPv6 blocks", () => {
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
    const lookup = dns.promises.lookup;
    dns.promises.lookup = () => Promise.reject(new Error("lookup should not be called"));
    try {
      await expect(isUrlSafeFromSsrf("http://[2606:4700:4700::1111]/")).resolves.toBe(true);
      await expect(isUrlSafeFromSsrf("http://[fe80::1]/")).resolves.toBe(false);
      await expect(isUrlSafeFromSsrf("http://[fc00::1]/")).resolves.toBe(false);
    } finally {
      dns.promises.lookup = lookup;
    }
  });
});
