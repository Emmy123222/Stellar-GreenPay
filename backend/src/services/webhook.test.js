/**
 * backend/src/services/webhook.test.js
 * Unit tests for webhook delivery SSRF protection and payload signing.
 *
 * NOTE: DNS resolution is mocked to avoid flaky, network-dependent tests.
 */
"use strict";

const dns = require("dns");

jest.mock("dns", () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const http = require("http");
const https = require("https");
const { deliverPayload, generateSignature } = require("./webhook");

function mockRequest(lib) {
  return jest.spyOn(lib, "request").mockImplementation((options, onResponse) => {
    const res = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === "end") setImmediate(cb);
      }),
    };
    setImmediate(() => onResponse && onResponse(res));
    return {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("deliverPayload - SSRF protection", () => {
  const secret = "a-secret-32-chars-min-length-value!!";
  const payload = { projectId: "p1", milestone: "M1" };

  beforeEach(() => {
    mockRequest(http);
    mockRequest(https);
  });

  test("rejects a hostname that resolves to a private IP", async () => {
    dns.promises.resolve4.mockResolvedValue(["127.0.0.1"]);
    dns.promises.resolve6.mockRejectedValue(new Error("ENODATA"));

    await expect(deliverPayload("http://internal.local/webhook", secret, payload)).rejects.toThrow(
      /blocked/i,
    );
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test("rejects a private IP literal", async () => {
    await expect(deliverPayload("http://10.0.0.1/webhook", secret, payload)).rejects.toThrow(
      /blocked|reserved/i,
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  test("rejects localhost", async () => {
    await expect(deliverPayload("http://localhost:9000/webhook", secret, payload)).rejects.toThrow(
      /localhost/i,
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  test("rejects a hostname that cannot be resolved", async () => {
    dns.promises.resolve4.mockRejectedValue(new Error("ENOTFOUND"));
    dns.promises.resolve6.mockRejectedValue(new Error("ENOTFOUND"));

    await expect(
      deliverPayload("http://does-not-exist.invalid/webhook", secret, payload),
    ).rejects.toThrow(/blocked|resolve/i);
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe("deliverPayload - delivery and signing", () => {
  const secret = "a-secret-32-chars-min-length-value!!";
  const payload = { projectId: "p1", milestone: "M1" };

  test("posts a signed payload to a public HTTPS URL", async () => {
    dns.promises.resolve4.mockResolvedValue(["93.184.216.34"]);
    dns.promises.resolve6.mockRejectedValue(new Error("ENODATA"));
    const requestSpy = mockRequest(https);

    const result = await deliverPayload("https://api.example.com/webhook", secret, payload);

    expect(result.statusCode).toBe(200);
    expect(requestSpy).toHaveBeenCalledTimes(1);

    const [options] = requestSpy.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["User-Agent"]).toBe("GreenPay-Webhook/1.0");
    expect(options.headers["X-Webhook-Signature"]).toBe(
      generateSignature(secret, JSON.stringify(payload)),
    );
  });

  test("delivers over HTTP for http:// URLs", async () => {
    const requestSpy = mockRequest(http);

    const result = await deliverPayload("http://93.184.216.34:8080/webhook", secret, payload);

    expect(result.statusCode).toBe(200);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });
});
