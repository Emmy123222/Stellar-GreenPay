"use strict";

process.env.NODE_ENV = "test";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock("http", () => ({ request: jest.fn() }));
jest.mock("https", () => ({ request: jest.fn() }));

jest.mock("dns", () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const dns = require("dns");
const http = require("http");
const https = require("https");
const logger = require("../logger");
const { deliverPayload } = require("./webhook");

function mockRequest(lib) {
  const req = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn(),
  };
  lib.request.mockReturnValue(req);
  return req;
}

describe("deliverPayload SSRF defense-in-depth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("blocks delivery to a private/blocked address and never makes an outbound request", async () => {
    const req = mockRequest(https);

    await deliverPayload(
      "http://169.254.169.254/metadata",
      "secret",
      { projectId: "proj-1", milestone: "50%" },
    );

    expect(https.request).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(req.write).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "webhook_blocked_ssrf" }),
      expect.any(String),
    );
  });

  test("blocks delivery to localhost", async () => {
    mockRequest(http);

    await deliverPayload("http://localhost:8080/internal", "secret", {
      projectId: "proj-1",
      milestone: "50%",
    });

    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test("does not reject even when the URL is blocked (fire-and-forget safe)", async () => {
    await expect(
      deliverPayload("http://127.0.0.1/", "secret", { projectId: "p", milestone: "m" }),
    ).resolves.toBeUndefined();
  });

  test("delivers normally to a public URL", async () => {
    dns.promises.resolve4.mockResolvedValue(["104.21.0.1"]);
    dns.promises.resolve6.mockRejectedValue(new Error("ENODATA"));
    const req = mockRequest(https);

    await deliverPayload("https://webhook.site/xyz", "secret", {
      projectId: "proj-1",
      milestone: "50%",
    });

    expect(https.request).toHaveBeenCalledTimes(1);
    expect(req.write).toHaveBeenCalledTimes(1);
    expect(req.end).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "webhook_blocked_ssrf" }),
      expect.any(String),
    );
  });
});
