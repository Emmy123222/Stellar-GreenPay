"use strict";

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
});
