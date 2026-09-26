"use strict";

// Unit tests for avatar processing (#1092). Uses real sharp for image
// assertions; pool, S3 and storage are mocked so no infra is needed.

const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const mockUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "greenpay-avatar-"));
const mockSend = jest.fn();
const mockQuery = jest.fn();

jest.mock("../db/pool", () => ({ query: (...args) => mockQuery(...args) }));
jest.mock("./storage", () => ({ UPLOAD_DIR: mockUploadDir }));
jest.mock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ type: "put", input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ type: "get", input })),
}));

const {
  processAvatar,
  processAvatarImage,
  resolveLocalUploadPath,
  resolveOwnS3Key,
  isProcessedAvatarKey,
  MAX_AVATAR_DIMENSION,
} = require("./profileQueue");

const PUBLIC_KEY = `G${"A".repeat(55)}`;
const S3_ENV = {
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  S3_BUCKET: "greenpay-test",
  S3_PUBLIC_URL: "https://cdn.greenpay.test",
};

function makeImage(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 160, b: 90 } },
  }).jpeg().toBuffer();
}

let savedEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
  Object.assign(process.env, S3_ENV);
  mockSend.mockReset().mockResolvedValue({});
  mockQuery.mockReset().mockResolvedValue({ rowCount: 1, rows: [] });
});
afterEach(() => {
  process.env = savedEnv;
});
afterAll(() => {
  fs.rmSync(mockUploadDir, { recursive: true, force: true });
});

describe("processAvatarImage", () => {
  test("downsizes a large image to fit within 256x256 and outputs WebP", async () => {
    const input = await makeImage(4000, 3000);
    const output = await processAvatarImage(input);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(MAX_AVATAR_DIMENSION);
    expect(meta.height).toBe(192); // aspect ratio preserved
    expect(output.length).toBeLessThan(input.length);
  });

  test("keeps tall images within bounds", async () => {
    const meta = await sharp(await processAvatarImage(await makeImage(300, 1200))).metadata();
    expect(meta.height).toBe(MAX_AVATAR_DIMENSION);
    expect(meta.width).toBe(64);
  });

  test("never upscales small images but still converts to WebP", async () => {
    const meta = await sharp(await processAvatarImage(await makeImage(100, 80))).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 100, height: 80 });
  });

  test("rejects non-image input", async () => {
    await expect(processAvatarImage(Buffer.from("not an image"))).rejects.toThrow();
  });
});

describe("resolveLocalUploadPath", () => {
  test("resolves a normal upload key inside UPLOAD_DIR", () => {
    expect(resolveLocalUploadPath("/api/uploads/abc.png")).toBe(path.join(mockUploadDir, "abc.png"));
  });

  test.each([
    "/api/uploads/../../etc/passwd",
    "/api/uploads/..%2F..%2Fetc%2Fpasswd",
    "/api/uploads/%2e%2e/secret",
    "/api/uploads/",
    "/api/uploads/%E0%A4%A",
    "/api/uploads/a%00b",
    "/etc/passwd",
    "https://evil.test/a.png",
    null,
  ])("rejects %p", (input) => {
    expect(resolveLocalUploadPath(input)).toBeNull();
  });
});

describe("resolveOwnS3Key / isProcessedAvatarKey", () => {
  test("accepts URLs under S3_PUBLIC_URL and the default bucket host", () => {
    expect(resolveOwnS3Key("https://cdn.greenpay.test/uploads/x.png")).toBe("uploads/x.png");
    expect(resolveOwnS3Key("https://greenpay-test.s3.us-east-1.amazonaws.com/uploads/y.jpg")).toBe("uploads/y.jpg");
  });

  test("rejects third-party hosts and lookalike prefixes", () => {
    expect(resolveOwnS3Key("https://gravatar.com/avatar/abc")).toBeNull();
    expect(resolveOwnS3Key("https://cdn.greenpay.test.evil.com/x.png")).toBeNull();
    expect(resolveOwnS3Key("not a url")).toBeNull();
  });

  test("recognises keys produced by buildAvatarKey", () => {
    expect(isProcessedAvatarKey(`avatars/${"a1".repeat(12)}-${PUBLIC_KEY}.webp`)).toBe(true);
    expect(isProcessedAvatarKey("uploads/photo.webp")).toBe(false);
  });
});

describe("processAvatar", () => {
  test("local upload: resizes, uploads WebP to S3, updates profile, deletes original", async () => {
    const localFile = path.join(mockUploadDir, "big.jpg");
    fs.writeFileSync(localFile, await makeImage(3000, 3000));
    const avatarUrl = "/api/uploads/big.jpg";

    const result = await processAvatar(PUBLIC_KEY, avatarUrl);

    expect(result.skipped).toBe(false);
    expect(result.newAvatarUrl).toMatch(/^https:\/\/cdn\.greenpay\.test\/avatars\/[0-9a-f]{24}-G[A_]+\.webp$/);

    const put = mockSend.mock.calls.find(([cmd]) => cmd.type === "put")[0].input;
    expect(put).toMatchObject({ Bucket: "greenpay-test", ContentType: "image/webp" });
    const meta = await sharp(put.Body).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/AND avatar_url = \$3/);
    expect(params).toEqual([result.newAvatarUrl, PUBLIC_KEY, avatarUrl]);

    expect(fs.existsSync(localFile)).toBe(false);
  });

  test("path traversal URL is skipped: nothing read, uploaded, or deleted", async () => {
    const outside = path.join(path.dirname(mockUploadDir), `victim-${Date.now()}.txt`);
    fs.writeFileSync(outside, "keep me");
    try {
      const rel = path.relative(mockUploadDir, outside).split(path.sep).join("/");
      const result = await processAvatar(PUBLIC_KEY, `/api/uploads/${rel}`);
      expect(result.skipped).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test("third-party avatar URL is skipped without touching S3", async () => {
    const result = await processAvatar(PUBLIC_KEY, "https://gravatar.com/avatar/abc");
    expect(result.skipped).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("already-processed avatar is not re-encoded", async () => {
    const url = `https://cdn.greenpay.test/avatars/${"b2".repeat(12)}-${PUBLIC_KEY}.webp`;
    const result = await processAvatar(PUBLIC_KEY, url);
    expect(result.skipped).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("own-bucket original is downloaded from S3 and replaced", async () => {
    const original = await makeImage(1024, 512);
    mockSend.mockImplementation(async (cmd) =>
      cmd.type === "get" ? { Body: (async function* () { yield original; })() } : {}
    );

    const result = await processAvatar(PUBLIC_KEY, "https://cdn.greenpay.test/uploads/orig.jpg");

    const get = mockSend.mock.calls.find(([cmd]) => cmd.type === "get")[0].input;
    expect(get).toEqual({ Bucket: "greenpay-test", Key: "uploads/orig.jpg" });
    const put = mockSend.mock.calls.find(([cmd]) => cmd.type === "put")[0].input;
    expect(await sharp(put.Body).metadata()).toMatchObject({ format: "webp", width: 256, height: 128 });
    expect(result.skipped).toBe(false);
  });

  test("S3 upload failure keeps the local original for retry", async () => {
    const localFile = path.join(mockUploadDir, "retry.jpg");
    fs.writeFileSync(localFile, await makeImage(600, 600));
    mockSend.mockRejectedValue(new Error("S3 down"));

    await expect(processAvatar(PUBLIC_KEY, "/api/uploads/retry.jpg")).rejects.toThrow("S3 down");
    expect(fs.existsSync(localFile)).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
