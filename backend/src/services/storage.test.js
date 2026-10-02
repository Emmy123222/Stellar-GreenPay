"use strict";

const path = require("path");
const { buildKey } = require("./storage");

describe("buildKey", () => {
  it("strips characters outside the allowed set", () => {
    expect(buildKey("my file!.pdf")).toMatch(/^[0-9a-f]{24}-my_file_\.pdf$/);
  });

  it("strips leading dots to prevent hidden-file uploads", () => {
    const key = buildKey(".hidden-file.png");
    expect(key).not.toMatch(/^\.|-\./);
    expect(key.startsWith(".")).toBe(false);
  });

  it("collapses consecutive dots to prevent path-traversal-style names", () => {
    const key = buildKey("../../etc/passwd");
    expect(key).not.toContain("..");
    expect(key).not.toContain("/");
  });

  it("never produces a key starting with a dot or containing a path separator", () => {
    const inputs = ["...", "....png", "../../../x", "..\\..\\x", ""];
    for (const input of inputs) {
      const key = buildKey(input);
      expect(key.startsWith(".")).toBe(false);
      expect(key).not.toContain("/");
      expect(key).not.toContain("\\");
    }
  });

  it("falls back to a default name when sanitization empties the string", () => {
    const key = buildKey("...");
    expect(key).toMatch(/^[0-9a-f]{24}-upload$/);
  });
});

describe("pinCidWithPinata", () => {
  const originalFetch = global.fetch;
  const originalJwt = process.env.PINATA_JWT;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalJwt === undefined) delete process.env.PINATA_JWT;
    else process.env.PINATA_JWT = originalJwt;
    jest.resetModules();
  });

  it("no-ops without calling Pinata when PINATA_JWT is unset", async () => {
    delete process.env.PINATA_JWT;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const { pinCidWithPinata } = require("./storage");
    await pinCidWithPinata("QmTestCid123");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs pinByHash to Pinata when PINATA_JWT is set", async () => {
    process.env.PINATA_JWT = "test-jwt-token";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    global.fetch = fetchMock;

    const { pinCidWithPinata } = require("./storage");
    await pinCidWithPinata("QmPinnedCid", "report.pdf");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pinata.cloud/pinning/pinByHash",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-jwt-token",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      hashToPin: "QmPinnedCid",
      pinataMetadata: { name: "report.pdf" },
    });
  });

  it("does not throw when Pinata returns a non-OK response", async () => {
    process.env.PINATA_JWT = "test-jwt-token";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    const { pinCidWithPinata } = require("./storage");
    await expect(pinCidWithPinata("QmFail")).resolves.toBeUndefined();
  });
});

describe("UPLOAD_DIR resolution", () => {
  const originalUploadDir = process.env.UPLOAD_DIR;

  afterEach(() => {
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it("uses the UPLOAD_DIR env var when set", () => {
    process.env.UPLOAD_DIR = "/custom/upload/path";
    const { UPLOAD_DIR } = require("./storage");
    expect(UPLOAD_DIR).toBe("/custom/upload/path");
  });

  it("defaults to /tmp/greenpay-uploads inside a Docker container", () => {
    delete process.env.UPLOAD_DIR;
    jest.spyOn(require("fs"), "existsSync").mockImplementation((p) => p === "/.dockerenv");

    const { UPLOAD_DIR } = require("./storage");
    expect(UPLOAD_DIR).toBe("/tmp/greenpay-uploads");
  });

  it("defaults to backend/uploads outside Docker", () => {
    delete process.env.UPLOAD_DIR;
    jest.spyOn(require("fs"), "existsSync").mockReturnValue(false);

    const { UPLOAD_DIR } = require("./storage");
    expect(UPLOAD_DIR).toBe(path.join(__dirname, "..", "..", "uploads"));
  });
});

describe("ensureUploadDir permission errors", () => {
  const originalBackend = process.env.STORAGE_BACKEND;
  const originalUploadDir = process.env.UPLOAD_DIR;

  afterEach(() => {
    if (originalBackend === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = originalBackend;
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it("logs and rethrows when the upload directory can't be created", async () => {
    process.env.STORAGE_BACKEND = "local";
    process.env.UPLOAD_DIR = "/no/such/writable/dir";

    const fs = require("fs");
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const mkdirErr = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw mkdirErr;
    });
    const logger = require("../logger");
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});

    const { uploadFile } = require("./storage");
    await expect(uploadFile(Buffer.from("x"), "f.txt", "text/plain")).rejects.toThrow("EACCES");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "storage_upload_dir_create_failed", dir: "/no/such/writable/dir" }),
      expect.any(String),
    );
  });
});

describe("uploadFile IPFS + Pinata", () => {
  const originalFetch = global.fetch;
  const originalBackend = process.env.STORAGE_BACKEND;
  const originalApi = process.env.IPFS_API_URL;
  const originalJwt = process.env.PINATA_JWT;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalBackend === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = originalBackend;
    if (originalApi === undefined) delete process.env.IPFS_API_URL;
    else process.env.IPFS_API_URL = originalApi;
    if (originalJwt === undefined) delete process.env.PINATA_JWT;
    else process.env.PINATA_JWT = originalJwt;
    jest.resetModules();
  });

  it("pins the CID with Pinata after a successful IPFS add", async () => {
    process.env.STORAGE_BACKEND = "ipfs";
    process.env.IPFS_API_URL = "http://ipfs.local:5001";
    process.env.PINATA_JWT = "pinata-jwt";
    process.env.IPFS_GATEWAY_URL = "https://gateway.example/ipfs";

    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("/api/v0/add")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ Hash: "QmUploadedCid", Size: "12" }),
        };
      }
      if (String(url).includes("pinata.cloud")) {
        return { ok: true, text: async () => "" };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { uploadFile } = require("./storage");
    const result = await uploadFile(Buffer.from("hello world"), "doc.pdf", "application/pdf");

    expect(result).toMatchObject({
      key: "QmUploadedCid",
      url: "https://gateway.example/ipfs/QmUploadedCid",
      backend: "ipfs",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.pinata.cloud/pinning/pinByHash",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
