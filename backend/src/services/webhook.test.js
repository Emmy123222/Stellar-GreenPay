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

jest.mock("../logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

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
  });
});
