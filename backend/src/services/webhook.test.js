/**
 * backend/src/services/webhook.test.js
 * Unit tests for webhook SSRF protection and payload delivery.
 *
 * DNS resolution is mocked so tests never touch the real network.
 */
"use strict";

const http = require("http");
const https = require("https");
const { deliverPayload } = require("./webhook");
const { isPrivateOrReservedIp, SsrfValidationError } = require("../utils/ssrf");

jest.mock("dns", () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const dns = require("dns");

describe("SSRF Protection - isPrivateOrReservedIp", () => {
  test("identifies loopback addresses (127.0.0.0/8)", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("127.0.0.254")).toBe(true);
    expect(isPrivateOrReservedIp("127.255.255.255")).toBe(true);
  });

  test("identifies private class A range (10.0.0.0/8)", () => {
    expect(isPrivateOrReservedIp("10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.255.255.255")).toBe(true);
  });

  test("identifies private class B range (172.16.0.0/12)", () => {
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIp("172.15.255.255")).toBe(false);
    expect(isPrivateOrReservedIp("172.32.0.1")).toBe(false);
  });

  test("identifies private class C range (192.168.0.0/16)", () => {
    expect(isPrivateOrReservedIp("192.168.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.255.255")).toBe(true);
    expect(isPrivateOrReservedIp("192.169.0.1")).toBe(false);
  });

  test("identifies link-local / cloud metadata range (169.254.0.0/16)", () => {
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.0.1")).toBe(true);
  });

  test("identifies 0.0.0.0/8 range", () => {
    expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true);
  });

  test("allows public IPv4 addresses", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);
  });

  test("handles IPv6 loopback and restricted ranges", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("::")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
  });

  test("handles IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:8.8.8.8")).toBe(false);
  });

  test("treats non-IP hostnames as unsafe", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
  });
});

describe("deliverPayload SSRF Protection", () => {
  let httpReqSpy;
  let httpsReqSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    const makeMockReq = () => ({
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    });

    httpReqSpy = jest.spyOn(http, "request").mockImplementation(() => makeMockReq());
    httpsReqSpy = jest.spyOn(https, "request").mockImplementation((_opts, cb) => {
      const mockReq = makeMockReq();
      // Simulate a 200 response so the delivery promise resolves.
      process.nextTick(() => {
        cb({
          statusCode: 200,
          on: (event, handler) => {
            if (event === "end") handler();
          },
        });
      });
      return mockReq;
    });

    dns.promises.resolve4.mockResolvedValue([]);
    dns.promises.resolve6.mockResolvedValue([]);
  });

  afterEach(() => {
    httpReqSpy.mockRestore();
    httpsReqSpy.mockRestore();
  });

  test("rejects localhost delivery", async () => {
    await expect(
      deliverPayload("http://localhost:8080/webhook", "secret123", { projectId: "p1", milestone: "M1" }),
    ).rejects.toThrow("localhost is not allowed");
    expect(http.request).not.toHaveBeenCalled();
  });

  test("rejects delivery to a private IP literal", async () => {
    await expect(
      deliverPayload("http://127.0.0.1/webhook", "secret123", { projectId: "p1", milestone: "M1" }),
    ).rejects.toThrow(SsrfValidationError);
    expect(http.request).not.toHaveBeenCalled();
  });

  test("rejects delivery to the cloud metadata IP", async () => {
    await expect(
      deliverPayload("http://169.254.169.254/latest/meta-data/", "secret123", { projectId: "p1", milestone: "M1" }),
    ).rejects.toThrow(SsrfValidationError);
    expect(http.request).not.toHaveBeenCalled();
  });

  test("blocks delivery when DNS resolves to a private IP (127.0.0.1)", async () => {
    dns.promises.resolve4.mockResolvedValue(["127.0.0.1"]);

    await expect(
      deliverPayload("http://internal-service.local/webhook", "secret123", { projectId: "p1", milestone: "M1" }),
    ).rejects.toThrow(/blocked address/i);
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test("blocks delivery when DNS resolves to a cloud metadata IP", async () => {
    dns.promises.resolve4.mockResolvedValue(["169.254.169.254"]);

    await expect(
      deliverPayload("http://metadata-service.local/webhook", "secret123", { projectId: "p1", milestone: "M1" }),
    ).rejects.toThrow(/blocked address/i);
    expect(http.request).not.toHaveBeenCalled();
  });

  test("blocks delivery when DNS resolution fails", async () => {
    dns.promises.resolve4.mockRejectedValue(new Error("ENOTFOUND"));
    dns.promises.resolve6.mockRejectedValue(new Error("ENOTFOUND"));

    await expect(
      deliverPayload("http://invalid-domain-does-not-exist.test/webhook", "secret123", { projectId: "p1", milestone: "M1" }),
    ).rejects.toThrow(/Could not resolve hostname/i);
    expect(http.request).not.toHaveBeenCalled();
  });

  test("allows delivery when DNS resolves to a public IP address", async () => {
    dns.promises.resolve4.mockResolvedValue(["93.184.216.34"]);

    await expect(
      deliverPayload("https://api.example.com/webhook", "secret123", { projectId: "p1", milestone: "M1" }),
    ).resolves.toEqual({ statusCode: 200 });
    expect(https.request).toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
  });

  test("allows delivery to a public IP literal", async () => {
    await expect(
      deliverPayload("https://93.184.216.34/webhook", "secret123", { projectId: "p1", milestone: "M1" }),
    ).resolves.toEqual({ statusCode: 200 });
    expect(https.request).toHaveBeenCalled();
  });
});
