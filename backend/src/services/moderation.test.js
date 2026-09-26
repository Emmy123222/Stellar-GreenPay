/**
 * src/services/moderation.test.js — unit tests for issue #1101 image moderation
 *
 * No AWS package is required to run this file:
 *   - @aws-sdk/client-rekognition is stubbed through the module's single seam,
 *     createRekognitionClient (lazily required in production code), and
 *   - @aws-sdk/client-s3 is stubbed with a plain jest.mock for the delete path.
 * The database is the usual mocked pool. Nothing here touches the network.
 */
"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ _params: params })),
}));

const pool = require("../db/pool");
const moderation = require("./moderation");

const {
  STATUS,
  OUTCOME,
  evaluateModerationResult,
  getModerationConfig,
  isModerationConfigured,
  detectUnsafeContent,
  moderateImage,
  recordModerationDecision,
  getLatestModerationDecision,
  attachDecisionToUpdateImage,
  deleteRejectedObject,
  resolveStoredImageLocation,
  storageKeyFromUrl,
  normaliseLabels,
  toConfidencePercent,
  moderationSummary,
} = moderation;

// ── Environment isolation ────────────────────────────────────────────────────

const MODERATION_ENV_KEYS = [
  "IMAGE_MODERATION_ENABLED",
  "IMAGE_MODERATION_FAIL_MODE",
  "IMAGE_MODERATION_REJECT_CONFIDENCE",
  "IMAGE_MODERATION_REVIEW_CONFIDENCE",
  "IMAGE_MODERATION_REJECT_FAMILIES",
  "IMAGE_MODERATION_TIMEOUT_MS",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_PUBLIC_URL",
];

const SAVED_ENV = {};

beforeAll(() => {
  MODERATION_ENV_KEYS.forEach((key) => {
    SAVED_ENV[key] = process.env[key];
  });
});

afterAll(() => {
  Object.entries(SAVED_ENV).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

/** Credentials present → moderation is "configured" (would really scan). */
function setAwsEnv() {
  process.env.AWS_REGION = "us-east-1";
  // Non-secret placeholders: only their presence matters, and the documented
  // AWS example pair trips the repo's Gitleaks scan.
  process.env.AWS_ACCESS_KEY_ID = "test-access-key-id";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-access-key";
  process.env.S3_BUCKET = "greenpay-uploads";
  delete process.env.S3_PUBLIC_URL;
}

/** No credentials → moderation is skipped entirely (local dev / CI). */
function clearAwsEnv() {
  ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_PUBLIC_URL"].forEach(
    (key) => delete process.env[key],
  );
  MODERATION_ENV_KEYS.forEach((key) => {
    if (key.startsWith("IMAGE_MODERATION_")) delete process.env[key];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearAwsEnv();
  pool.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  if (moderation.createRekognitionClient.mockRestore) moderation.createRekognitionClient.mockRestore();
});

// ── Fake Rekognition client ──────────────────────────────────────────────────

function FakeCommand(input) {
  this.input = input;
}

/**
 * Replace the AWS seam for one test.
 * @param {{labels?: Array, error?: Error}} behaviour
 */
function stubRekognition({ labels = [], error = null } = {}) {
  const send = error ? jest.fn().mockRejectedValue(error) : jest.fn().mockResolvedValue({ Labels: labels });
  const client = { send };
  const spy = jest
    .spyOn(moderation, "createRekognitionClient")
    .mockReturnValue({ client, DetectModerationLabelsCommand: FakeCommand });
  return { spy, client, send };
}

/** Raw Rekognition-shaped label. */
function rawLabel(name, confidence, parentName, categories = ["Violence"]) {
  return {
    Name: name,
    ParentName: parentName,
    Confidence: confidence,
    Categories: categories.map((category) => ({ Name: category })),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Config
// ═════════════════════════════════════════════════════════════════════════════

describe("getModerationConfig", () => {
  test("defaults match the acceptance criteria (enabled, fail-closed, 70 / 50)", () => {
    const config = getModerationConfig();
    expect(config.enabled).toBe(true);
    expect(config.failMode).toBe("closed");
    expect(config.rejectConfidence).toBe(70);
    expect(config.reviewConfidence).toBe(50);
    expect(config.rejectFamilies).toEqual(["Explicit Nudity", "Violence"]);
    expect(config.requestTimeoutMs).toBe(5000);
  });

  test("reads overrides from the environment at call time", () => {
    process.env.IMAGE_MODERATION_ENABLED = "false";
    process.env.IMAGE_MODERATION_FAIL_MODE = "open";
    process.env.IMAGE_MODERATION_REJECT_CONFIDENCE = "85";
    process.env.IMAGE_MODERATION_REVIEW_CONFIDENCE = "60";
    process.env.IMAGE_MODERATION_REJECT_FAMILIES = "Nudity, Weapons ";
    process.env.IMAGE_MODERATION_TIMEOUT_MS = "1200";

    const config = getModerationConfig();
    expect(config.enabled).toBe(false);
    expect(config.failMode).toBe("open");
    expect(config.rejectConfidence).toBe(85);
    expect(config.reviewConfidence).toBe(60);
    expect(config.rejectFamilies).toEqual(["Nudity", "Weapons"]);
    expect(config.requestTimeoutMs).toBe(1200);
  });

  test("garbage env values fall back to the safe defaults", () => {
    process.env.IMAGE_MODERATION_ENABLED = "maybe";
    process.env.IMAGE_MODERATION_FAIL_MODE = "yolo";
    process.env.IMAGE_MODERATION_REJECT_CONFIDENCE = "high";
    process.env.IMAGE_MODERATION_REJECT_FAMILIES = ",,  ";

    const config = getModerationConfig();
    expect(config.enabled).toBe(true);
    expect(config.failMode).toBe("closed");
    expect(config.rejectConfidence).toBe(70);
    expect(config.rejectFamilies).toEqual(["Explicit Nudity", "Violence"]);
  });

  test("thresholds are clamped into the 0–100 percent range", () => {
    process.env.IMAGE_MODERATION_REJECT_CONFIDENCE = "500";
    process.env.IMAGE_MODERATION_REVIEW_CONFIDENCE = "-20";
    const config = getModerationConfig();
    expect(config.rejectConfidence).toBe(100);
    expect(config.reviewConfidence).toBe(0);
  });
});

describe("isModerationConfigured", () => {
  test("false when AWS credentials are absent", () => {
    expect(isModerationConfigured()).toBe(false);
  });

  test("false when only some credentials are present", () => {
    process.env.AWS_REGION = "us-east-1";
    expect(isModerationConfigured()).toBe(false);
  });

  test("true once region + access key + secret are set", () => {
    setAwsEnv();
    expect(isModerationConfigured()).toBe(true);
    expect(moderation.isModerationEnforced()).toBe(true);
  });

  test("false when credentials exist but no bucket is configured (no S3-published images)", () => {
    setAwsEnv();
    delete process.env.S3_BUCKET;
    expect(isModerationConfigured()).toBe(false);
    expect(moderation.isModerationEnforced()).toBe(false);
  });

  test("isModerationEnforced is false when explicitly disabled", () => {
    setAwsEnv();
    process.env.IMAGE_MODERATION_ENABLED = "false";
    expect(moderation.isModerationEnforced()).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Label normalisation
// ═════════════════════════════════════════════════════════════════════════════

describe("toConfidencePercent", () => {
  test("keeps Rekognition percentages as-is", () => {
    expect(toConfidencePercent(87.5)).toBe(87.5);
    expect(toConfidencePercent("42")).toBe(42);
    expect(toConfidencePercent(0)).toBe(0);
  });

  test("clamps out-of-range values and rejects non-numeric ones", () => {
    expect(toConfidencePercent(140)).toBe(100);
    expect(toConfidencePercent(-5)).toBe(0);
    expect(toConfidencePercent("abc")).toBe(0);
    expect(toConfidencePercent(undefined)).toBe(0);
    expect(toConfidencePercent(NaN)).toBe(0);
  });
});

describe("normaliseLabels", () => {
  test("maps the raw Rekognition shape into { name, family, confidence, categories }", () => {
    const labels = normaliseLabels([
      rawLabel("Explicit Nudity/Graphic Nudity", 91.2, "Explicit Nudity", ["Sexual Scene"]),
    ]);
    expect(labels).toEqual([
      {
        name: "Explicit Nudity/Graphic Nudity",
        family: "Explicit Nudity",
        confidence: 91.2,
        categories: ["Sexual Scene"],
      },
    ]);
  });

  test("derives the family from the label name when ParentName is missing", () => {
    const [label] = normaliseLabels([{ Name: "Violence/Weapons", Confidence: 80 }]);
    expect(label.family).toBe("Violence");
  });

  test("accepts already-normalised labels and drops unusable entries", () => {
    const labels = normaliseLabels([
      { name: "Suggestive", confidence: 55, categories: [] },
      { Confidence: 90 },
      null,
      "nope",
    ]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual({ name: "Suggestive", family: "Suggestive", confidence: 55, categories: [] });
  });

  test("returns [] for non-array input", () => {
    expect(normaliseLabels(undefined)).toEqual([]);
    expect(normaliseLabels({})).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// evaluateModerationResult — the pure decision matrix
// ═════════════════════════════════════════════════════════════════════════════

describe("evaluateModerationResult — auto-reject (AC: Explicit Nudity / Violence above 70%)", () => {
  test("Explicit Nudity above 70 → rejected", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Graphic Nudity", family: "Explicit Nudity", confidence: 80, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.REJECTED);
    expect(verdict.flaggedForReview).toBe(false);
    expect(verdict.maxConfidence).toBe(80);
    expect(verdict.reason).toMatch(/auto-rejected/i);
    expect(verdict.reason).toMatch(/Explicit Nudity/);
    expect(verdict.triggeringLabels).toHaveLength(1);
  });

  test("Violence above 70 → rejected", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Graphic Violence", family: "Violence", confidence: 99.9, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.REJECTED);
  });

  test("nested Rekognition names are matched by family", () => {
    const verdict = evaluateModerationResult(
      normaliseLabels([rawLabel("Explicit Nudity/Masked Nudity", 77, "Explicit Nudity")]),
    );
    expect(verdict.status).toBe(STATUS.REJECTED);
  });

  test("family matching is case-insensitive", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "war scene", family: "VIOLENCE", confidence: 95, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.REJECTED);
  });

  test("exactly 70 is NOT auto-rejected (the AC says 'above 70%') — it falls through to review", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Graphic Nudity", family: "Explicit Nudity", confidence: 70, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.PENDING_REVIEW);
    expect(verdict.flaggedForReview).toBe(true);
    expect(verdict.triggeringLabels).toHaveLength(0);
  });

  test("just above 70 is auto-rejected", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Graphic Nudity", family: "Explicit Nudity", confidence: 70.01, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.REJECTED);
  });

  test("Explicit Nudity / Violence below the reject threshold are only flagged", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Non-consensual Nudity", family: "Explicit Nudity", confidence: 65, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.PENDING_REVIEW);
  });

  test("the worst triggering label drives the reason, and maxConfidence is the global max", () => {
    const verdict = evaluateModerationResult({
      labels: [
        { name: "Weapons", family: "Violence", confidence: 74, categories: [] },
        { name: "Graphic Nudity", family: "Explicit Nudity", confidence: 91, categories: [] },
        { name: "Smoking", family: "Tobacco", confidence: 96, categories: [] },
      ],
    });
    expect(verdict.status).toBe(STATUS.REJECTED);
    expect(verdict.reason).toContain("91");
    expect(verdict.maxConfidence).toBe(96);
  });
});

describe("evaluateModerationResult — admin review queue", () => {
  test("other unsafe labels at or above the 50% review threshold → pending_review", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Suggestive", family: "Suggestive", confidence: 62, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.PENDING_REVIEW);
    expect(verdict.flaggedForReview).toBe(true);
    expect(verdict.reviewLabels).toHaveLength(1);
    expect(verdict.reason).toMatch(/manual review/i);
  });

  test("boundary: exactly the review threshold flags the image", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Gambling", family: "Gambling", confidence: 50, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.PENDING_REVIEW);
  });

  test("labels under the review threshold are kept for the audit trail but approved", () => {
    const verdict = evaluateModerationResult({
      labels: [{ name: "Drugs", family: "Drugs", confidence: 12, categories: [] }],
    });
    expect(verdict.status).toBe(STATUS.APPROVED);
    expect(verdict.flaggedForReview).toBe(false);
    expect(verdict.labels).toHaveLength(1);
    expect(verdict.maxConfidence).toBe(12);
  });
});

describe("evaluateModerationResult — clean input", () => {
  test("no labels → approved", () => {
    const verdict = evaluateModerationResult({ labels: [] });
    expect(verdict.status).toBe(STATUS.APPROVED);
    expect(verdict.reason).toBeNull();
    expect(verdict.maxConfidence).toBe(0);
    expect(verdict.flaggedForReview).toBe(false);
  });

  test("missing/undefined result → approved, never throws", () => {
    expect(evaluateModerationResult(undefined).status).toBe(STATUS.APPROVED);
    expect(evaluateModerationResult(null).status).toBe(STATUS.APPROVED);
    expect(evaluateModerationResult({}).status).toBe(STATUS.APPROVED);
  });

  test("a bare label array is accepted", () => {
    const verdict = evaluateModerationResult([
      { name: "Graphic Violence", family: "Violence", confidence: 90, categories: [] },
    ]);
    expect(verdict.status).toBe(STATUS.REJECTED);
  });
});

describe("evaluateModerationResult — configurable thresholds", () => {
  test("custom reject threshold honours the boundary", () => {
    const labels = [{ name: "Nudity", family: "Explicit Nudity", confidence: 80, categories: [] }];
    expect(evaluateModerationResult({ labels }, { rejectAbove: 90 }).status).toBe(STATUS.PENDING_REVIEW);
    expect(evaluateModerationResult({ labels }, { rejectAbove: 80 }).status).toBe(STATUS.PENDING_REVIEW);
    expect(evaluateModerationResult({ labels }, { rejectAbove: 79 }).status).toBe(STATUS.REJECTED);
  });

  test("custom review threshold can approve what the default flags", () => {
    const labels = [{ name: "Suggestive", family: "Suggestive", confidence: 60, categories: [] }];
    expect(evaluateModerationResult({ labels }, { reviewAtLeast: 75 }).status).toBe(STATUS.APPROVED);
  });

  test("custom reject families change what auto-rejects", () => {
    const labels = [{ name: "Graphic Violence", family: "Violence", confidence: 95, categories: [] }];
    expect(evaluateModerationResult({ labels }, { rejectFamilies: ["Explicit Nudity"] }).status).toBe(
      STATUS.PENDING_REVIEW,
    );
  });

  test("reads thresholds from the environment when opts are absent", () => {
    process.env.IMAGE_MODERATION_REJECT_CONFIDENCE = "95";
    const labels = [{ name: "Nudity", family: "Explicit Nudity", confidence: 90, categories: [] }];
    expect(evaluateModerationResult({ labels }).status).toBe(STATUS.PENDING_REVIEW);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// detectUnsafeContent
// ═════════════════════════════════════════════════════════════════════════════

describe("detectUnsafeContent", () => {
  test("requires either an S3 location or bytes", async () => {
    await expect(detectUnsafeContent({})).rejects.toMatchObject({ code: "MODERATION_UNAVAILABLE" });
    await expect(detectUnsafeContent({ bucket: "b" })).rejects.toMatchObject({
      code: "MODERATION_UNAVAILABLE",
    });
    await expect(detectUnsafeContent({ bytes: Buffer.alloc(0) })).rejects.toMatchObject({
      code: "MODERATION_UNAVAILABLE",
    });
  });

  test("scans an S3 object with the S3Object form", async () => {
    const { send } = stubRekognition({ labels: [rawLabel("Suggestive", 55, "Suggestive")] });
    const result = await detectUnsafeContent({ bucket: "greenpay-uploads", key: "abc-photo.jpg" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toEqual({
      S3Object: { Bucket: "greenpay-uploads", Name: "abc-photo.jpg" },
    });
    expect(result.source).toBe("rekognition_s3_object");
    expect(result.provider).toBe("aws_rekognition");
    expect(result.labels).toEqual([
      { name: "Suggestive", family: "Suggestive", confidence: 55, categories: ["Violence"] },
    ]);
  });

  test("scans in-memory bytes with the ImageContent form", async () => {
    const { send } = stubRekognition();
    const bytes = Buffer.from("fake-jpeg-bytes");
    const result = await detectUnsafeContent({ bytes });

    expect(send.mock.calls[0][0].input).toEqual({ ImageContent: { Bytes: bytes } });
    expect(result.source).toBe("rekognition_image_bytes");
    expect(result.bucket).toBeNull();
    expect(result.key).toBeNull();
  });

  test("tolerates an API response without labels", async () => {
    stubRekognition({ labels: undefined });
    const result = await detectUnsafeContent({ bucket: "b", key: "k" });
    expect(result.labels).toEqual([]);
  });

  test("wraps API errors as MODERATION_UNAVAILABLE (never a raw SDK throw)", async () => {
    stubRekognition({ error: new Error("AccessDenied") });
    await expect(detectUnsafeContent({ bucket: "b", key: "k" })).rejects.toBeInstanceOf(
      moderation.ModerationUnavailableError,
    );
    await expect(detectUnsafeContent({ bucket: "b", key: "k" })).rejects.toMatchObject({
      code: "MODERATION_UNAVAILABLE",
      message: expect.stringMatching(/AccessDenied/),
    });
  });

  test("the lazy SDK require never throws a raw module error out of the factory", () => {
    // @aws-sdk/client-rekognition is an optional dependency in this repo: when
    // it is missing the factory must surface a MODERATION_UNAVAILABLE error;
    // when installed it must return a usable client/command pair.
    let outcome;
    try {
      outcome = { client: moderation.createRekognitionClient() };
    } catch (err) {
      outcome = { error: err };
    }
    if (outcome.error) {
      expect(outcome.error.code).toBe("MODERATION_UNAVAILABLE");
    } else {
      expect(typeof outcome.client.client.send).toBe("function");
      expect(typeof outcome.client.DetectModerationLabelsCommand).toBe("function");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// S3 location resolution
// ═════════════════════════════════════════════════════════════════════════════

describe("resolveStoredImageLocation", () => {
  test("virtual-hosted S3 URL", () => {
    setAwsEnv();
    expect(
      resolveStoredImageLocation("https://greenpay-uploads.s3.us-east-1.amazonaws.com/abc-photo.jpg"),
    ).toEqual({ bucket: "greenpay-uploads", key: "abc-photo.jpg" });
  });

  test("path-style S3 URL", () => {
    setAwsEnv();
    expect(
      resolveStoredImageLocation("https://s3.us-east-1.amazonaws.com/greenpay-uploads/dir/photo.png"),
    ).toEqual({ bucket: "greenpay-uploads", key: "dir/photo.png" });
  });

  test("custom S3_PUBLIC_URL domain maps to the configured bucket", () => {
    setAwsEnv();
    process.env.S3_PUBLIC_URL = "https://cdn.example.com/public";
    expect(resolveStoredImageLocation("https://cdn.example.com/public/abc-photo.jpg")).toEqual({
      bucket: "greenpay-uploads",
      key: "abc-photo.jpg",
    });
  });

  test("S3_PUBLIC_URL without a path prefix, and the region-less bucket domain", () => {
    setAwsEnv();
    process.env.S3_PUBLIC_URL = "https://cdn.example.com/";
    expect(resolveStoredImageLocation("https://cdn.example.com/abc-photo.jpg")).toEqual({
      bucket: "greenpay-uploads",
      key: "abc-photo.jpg",
    });
    expect(resolveStoredImageLocation("https://greenpay-uploads.s3.amazonaws.com/a/b.png")).toEqual({
      bucket: "greenpay-uploads",
      key: "a/b.png",
    });
  });

  test("percent-encoded keys are decoded once", () => {
    setAwsEnv();
    expect(
      resolveStoredImageLocation("https://greenpay-uploads.s3.us-east-1.amazonaws.com/my%20photo.jpg"),
    ).toEqual({ bucket: "greenpay-uploads", key: "my photo.jpg" });
  });

  test("dualstack endpoints resolve, non-S3 AWS endpoints do not", () => {
    setAwsEnv();
    expect(
      resolveStoredImageLocation("https://greenpay-uploads.s3.dualstack.eu-west-1.amazonaws.com/x.png"),
    ).toEqual({ bucket: "greenpay-uploads", key: "x.png" });
    expect(
      resolveStoredImageLocation("https://greenpay-uploads.s3-website-us-east-1.amazonaws.com/x.png"),
    ).toBeNull();
  });

  test("a bucket other than the configured one is ignored", () => {
    setAwsEnv();
    expect(
      resolveStoredImageLocation("https://someone-elses-bucket.s3.us-east-1.amazonaws.com/x.jpg"),
    ).toBeNull();
  });

  test("foreign hosts, relative paths and junk URLs resolve to null", () => {
    setAwsEnv();
    expect(resolveStoredImageLocation("https://cdn.example.com/photo.jpg")).toBeNull();
    expect(resolveStoredImageLocation("/api/uploads/abc-photo.jpg")).toBeNull();
    expect(resolveStoredImageLocation("not a url")).toBeNull();
    expect(resolveStoredImageLocation("")).toBeNull();
    expect(resolveStoredImageLocation(undefined)).toBeNull();
    expect(resolveStoredImageLocation("ftp://files.example.com/a.jpg")).toBeNull();
  });

  test("storageKeyFromUrl returns just the key", () => {
    setAwsEnv();
    expect(
      storageKeyFromUrl("https://greenpay-uploads.s3.us-east-1.amazonaws.com/k1.jpg"),
    ).toBe("k1.jpg");
    expect(storageKeyFromUrl("https://cdn.example.com/k1.jpg")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Persistence
// ═════════════════════════════════════════════════════════════════════════════

function insertCall() {
  const call = pool.query.mock.calls.find(([sql]) => /INSERT INTO update_images/.test(sql));
  expect(call).toBeDefined();
  return call;
}

describe("recordModerationDecision", () => {
  test("inserts one update_images audit row with the verdict details", async () => {
    const id = await recordModerationDecision({
      updateId: "upd-1",
      projectId: "proj-1",
      storageKey: "abc-photo.jpg",
      imageUrl: "https://greenpay-uploads.s3.us-east-1.amazonaws.com/abc-photo.jpg",
      storageBackend: "s3",
      status: STATUS.REJECTED,
      provider: "aws_rekognition",
      maxConfidence: 91.5,
      labels: [{ name: "Graphic Nudity", family: "Explicit Nudity", confidence: 91.5, categories: [] }],
      reason: "Explicit nudity detected",
      flaggedForReview: false,
    });

    expect(id).toBeTruthy();
    const [sql, params] = insertCall();
    expect(sql).toMatch(/INSERT INTO update_images/);
    expect(params).toHaveLength(12);
    expect(params[1]).toBe("upd-1");
    expect(params[2]).toBe("proj-1");
    expect(params[3]).toBe("abc-photo.jpg");
    expect(params[6]).toBe("rejected");
    expect(params[7]).toBe(false);
    expect(params[8]).toBe("aws_rekognition");
    expect(params[9]).toBe(91.5);
    expect(JSON.parse(params[10])).toEqual([
      { name: "Graphic Nudity", family: "Explicit Nudity", confidence: 91.5, categories: [] },
    ]);
    expect(params[11]).toBe("Explicit nudity detected");
  });

  test("an upload-time decision has no update_id yet", async () => {
    await recordModerationDecision({
      storageKey: "k.jpg",
      imageUrl: "https://bucket.s3.us-east-1.amazonaws.com/k.jpg",
      status: STATUS.APPROVED,
      maxConfidence: 3,
      labels: [],
    });
    const [, params] = insertCall();
    expect(params[1]).toBeNull();
    expect(params[5]).toBe("s3");
  });

  test("an unknown status is never silently stored as approved", async () => {
    await recordModerationDecision({ imageUrl: "https://x/y.jpg", status: "totally-fine" });
    const [, params] = insertCall();
    expect(params[6]).toBe(STATUS.PENDING_REVIEW);
    expect(params[7]).toBe(true);
  });

  test("max_confidence is clamped into the column's 0–100 CHECK range", async () => {
    await recordModerationDecision({ imageUrl: "https://x/y.jpg", status: STATUS.APPROVED, maxConfidence: 4000 });
    const [, params] = insertCall();
    expect(params[9]).toBe(100);
  });

  test("a DB failure is logged and swallowed — it must not break a route", async () => {
    pool.query.mockRejectedValueOnce(new Error("update_images table is missing"));
    await expect(
      recordModerationDecision({ imageUrl: "https://x/y.jpg", status: STATUS.REJECTED }),
    ).resolves.toBeNull();
    expect(insertCall()).toBeDefined();
  });
});

describe("getLatestModerationDecision", () => {
  test("returns null without a key or URL (no pointless query)", async () => {
    expect(await getLatestModerationDecision({})).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("looks up by storage key and image URL, newest first", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "dec-1",
          update_id: null,
          project_id: "proj-1",
          storage_key: "abc.jpg",
          image_url: "https://b.s3.us-east-1.amazonaws.com/abc.jpg",
          status: "rejected",
          flagged_for_review: false,
          provider: "aws_rekognition",
          max_confidence: "88.00",
          moderation_labels: [{ name: "Nudity", family: "Explicit Nudity", confidence: 88, categories: [] }],
          reason: "nope",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const row = await getLatestModerationDecision({ storageKey: "abc.jpg", imageUrl: "https://x/abc.jpg" });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM update_images/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toEqual(["abc.jpg", "https://x/abc.jpg"]);
    expect(row.id).toBe("dec-1");
    expect(row.status).toBe(STATUS.REJECTED);
    expect(row.maxConfidence).toBe(88);
    expect(row.labels).toHaveLength(1);
  });

  test("null when no decision exists for the object", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await getLatestModerationDecision({ storageKey: "never-seen.jpg" })).toBeNull();
  });
});

describe("attachDecisionToUpdateImage", () => {
  test("back-fills update_id and project_id on the earlier upload-time row", async () => {
    const ok = await attachDecisionToUpdateImage({ decisionId: "dec-1", updateId: "upd-1", projectId: "proj-1" });
    expect(ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE update_images/);
    expect(params).toEqual(["dec-1", "upd-1", "proj-1"]);
  });

  test("no-op without a decisionId; DB errors are swallowed", async () => {
    expect(await attachDecisionToUpdateImage({ updateId: "upd-1" })).toBe(false);
    pool.query.mockRejectedValueOnce(new Error("boom"));
    expect(await attachDecisionToUpdateImage({ decisionId: "dec-1", updateId: "upd-1" })).toBe(false);
  });
});

describe("deleteRejectedObject", () => {
  test("deletes the rejected S3 object best-effort", async () => {
    const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const send = jest.fn().mockResolvedValue({});
    S3Client.mockImplementation(() => ({ send }));

    await expect(deleteRejectedObject({ bucket: "b", key: "bad.jpg" })).resolves.toBe(true);
    expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: "b", Key: "bad.jpg" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("delete failures never surface to the caller", async () => {
    const { S3Client } = require("@aws-sdk/client-s3");
    S3Client.mockImplementation(() => ({ send: jest.fn().mockRejectedValue(new Error("AccessDenied")) }));
    await expect(deleteRejectedObject({ bucket: "b", key: "bad.jpg" })).resolves.toBe(false);
  });

  test("no-ops when the object location is unknown", async () => {
    await expect(deleteRejectedObject({ bucket: "b" })).resolves.toBe(false);
    await expect(deleteRejectedObject({})).resolves.toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// moderateImage — orchestration + fail-open / fail-closed policy
// ═════════════════════════════════════════════════════════════════════════════

const S3_URL = "https://greenpay-uploads.s3.us-east-1.amazonaws.com/upd-photo.jpg";

describe("moderateImage — when moderation does not run", () => {
  test("skipped (not configured) when AWS credentials are absent", async () => {
    const spy = jest.spyOn(moderation, "createRekognitionClient");
    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.applied).toBe(false);
    expect(verdict.status).toBe(OUTCOME.SKIPPED);
    expect(verdict.skipReason).toBe("not_configured");
    expect(verdict.blocked).toBe(false);
    expect(verdict.newDecision).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("skipped (disabled) even with credentials when IMAGE_MODERATION_ENABLED=false", async () => {
    setAwsEnv();
    process.env.IMAGE_MODERATION_ENABLED = "false";
    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(OUTCOME.SKIPPED);
    expect(verdict.skipReason).toBe("disabled");
    expect(verdict.blocked).toBe(false);
  });
});

describe("moderateImage — scanning paths", () => {
  beforeEach(() => setAwsEnv());

  test("rejected: explicit nudity above 70 blocks publishing", async () => {
    stubRekognition({ labels: [rawLabel("Graphic Nudity", 93, "Explicit Nudity")] });
    const verdict = await moderateImage({ imageUrl: S3_URL });

    expect(verdict.status).toBe(STATUS.REJECTED);
    expect(verdict.blocked).toBe(true);
    expect(verdict.newDecision).toBe(true);
    expect(verdict.storageKey).toBe("upd-photo.jpg");
    expect(verdict.bucket).toBe("greenpay-uploads");
    expect(verdict.maxConfidence).toBe(93);
    expect(verdict.reason).toMatch(/Explicit Nudity/);
  });

  test("pending_review: suggestive content is published but flagged", async () => {
    stubRekognition({ labels: [rawLabel("Suggestive", 61, "Suggestive")] });
    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(STATUS.PENDING_REVIEW);
    expect(verdict.blocked).toBe(false);
    expect(verdict.flaggedForReview).toBe(true);
  });

  test("approved: a clean image passes and is still logged", async () => {
    stubRekognition({ labels: [] });
    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(STATUS.APPROVED);
    expect(verdict.blocked).toBe(false);
    expect(verdict.newDecision).toBe(true);
  });

  test("in-memory bytes are scanned directly, skipping the S3 lookup", async () => {
    const { send } = stubRekognition({ labels: [rawLabel("Graphic Violence", 99, "Violence")] });
    const verdict = await moderateImage({
      bytes: Buffer.from("jpeg-bytes"),
      imageUrl: "/api/uploads/x.jpg",
      key: "x.jpg",
      storageBackend: "s3",
    });

    expect(verdict.status).toBe(STATUS.REJECTED);
    expect(send.mock.calls[0][0].input).toEqual({ ImageContent: { Bytes: Buffer.from("jpeg-bytes") } });
    expect(pool.query).not.toHaveBeenCalled(); // no prior-decision lookup for fresh bytes
  });

  test("an explicit bucket+key skips URL resolution", async () => {
    const { send } = stubRekognition();
    const verdict = await moderateImage({ bucket: "other-bucket", key: "sub/dir.jpg", imageUrl: "" });
    expect(send.mock.calls[0][0].input).toEqual({
      S3Object: { Bucket: "other-bucket", Name: "sub/dir.jpg" },
    });
    expect(verdict.storageKey).toBe("sub/dir.jpg");
  });
});

describe("moderateImage — reuse of an earlier decision", () => {
  beforeEach(() => setAwsEnv());

  test("a rejected upload-time decision blocks the update without re-scanning", async () => {
    const { client } = stubRekognition();
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "dec-9",
          status: "rejected",
          reason: "Explicit nudity detected",
          max_confidence: "88.00",
          moderation_labels: [],
          flagged_for_review: false,
          provider: "aws_rekognition",
          storage_key: "upd-photo.jpg",
          image_url: S3_URL,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(STATUS.REJECTED);
    expect(verdict.blocked).toBe(true);
    expect(verdict.newDecision).toBe(false);
    expect(verdict.decisionId).toBe("dec-9");
    expect(verdict.reusedPriorDecision).toBe(true);
    expect(client.send).not.toHaveBeenCalled();
  });

  test("an approved decision short-circuits the Rekognition call", async () => {
    const { client } = stubRekognition({ labels: [rawLabel("Graphic Nudity", 99, "Explicit Nudity")] });
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "dec-8",
          status: "approved",
          reason: null,
          max_confidence: "4.00",
          moderation_labels: [],
          flagged_for_review: false,
          provider: "aws_rekognition",
          storage_key: "upd-photo.jpg",
          image_url: S3_URL,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(STATUS.APPROVED);
    expect(verdict.blocked).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe("moderateImage — failure policy (documented in the module header)", () => {
  beforeEach(() => setAwsEnv());

  test("DEFAULT fail-closed: an SDK/API error yields 'unavailable' + blocked, no crash", async () => {
    stubRekognition({ error: new Error("ThrottlingException") });
    const verdict = await moderateImage({ imageUrl: S3_URL });

    expect(verdict.status).toBe(OUTCOME.UNAVAILABLE);
    expect(verdict.blocked).toBe(true);
    expect(verdict.newDecision).toBe(false);
    expect(verdict.reason).toMatch(/could not be scanned/i);
    expect(verdict.reason).toMatch(/ThrottlingException/);
  });

  test("DEFAULT fail-closed: a missing SDK is treated the same way", async () => {
    jest
      .spyOn(moderation, "createRekognitionClient")
      .mockImplementation(() => {
        throw new moderation.ModerationUnavailableError("Image moderation service is not installed on this server");
      });
    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(OUTCOME.UNAVAILABLE);
    expect(verdict.blocked).toBe(true);
  });

  test("opt-in fail-open: the same error publishes the image flagged for admin review", async () => {
    process.env.IMAGE_MODERATION_FAIL_MODE = "open";
    stubRekognition({ error: new Error("ServiceUnavailable") });

    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(STATUS.PENDING_REVIEW);
    expect(verdict.blocked).toBe(false);
    expect(verdict.flaggedForReview).toBe(true);
    expect(verdict.newDecision).toBe(true);
    expect(verdict.reason).toMatch(/fail-open/i);
  });

  test("an image URL we do not own cannot be scanned → closed blocks, open flags", async () => {
    const spy = jest.spyOn(moderation, "createRekognitionClient");

    const closed = await moderateImage({ imageUrl: "https://elsewhere.example.com/a.jpg" });
    expect(closed.status).toBe(OUTCOME.UNAVAILABLE);
    expect(closed.blocked).toBe(true);
    expect(closed.reason).toMatch(/does not point at the configured S3 bucket/);
    expect(spy).not.toHaveBeenCalled(); // never download arbitrary user URLs

    process.env.IMAGE_MODERATION_FAIL_MODE = "open";
    const open = await moderateImage({ imageUrl: "https://elsewhere.example.com/a.jpg" });
    expect(open.status).toBe(STATUS.PENDING_REVIEW);
    expect(open.flaggedForReview).toBe(true);
    expect(open.blocked).toBe(false);
  });

  test("a broken audit lookup fails closed rather than publishing blind", async () => {
    stubRekognition();
    pool.query.mockRejectedValueOnce(new Error("relation update_images does not exist"));
    const verdict = await moderateImage({ imageUrl: S3_URL });
    expect(verdict.status).toBe(OUTCOME.UNAVAILABLE);
    expect(verdict.blocked).toBe(true);
  });

  test("moderateImage never rejects", async () => {
    clearAwsEnv();
    expect((await moderateImage({})).status).toBe(OUTCOME.SKIPPED);

    setAwsEnv();
    // Nothing to scan while configured → the fail-closed policy blocks instead
    // of throwing out of the route handler.
    await expect(moderateImage({})).resolves.toMatchObject({ blocked: true });
    await expect(moderateImage(undefined)).resolves.toMatchObject({ blocked: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Response helper
// ═════════════════════════════════════════════════════════════════════════════

describe("moderationSummary", () => {
  test("exposes the verdict without dumping raw labels", () => {
    const summary = moderationSummary({
      applied: true,
      status: STATUS.PENDING_REVIEW,
      flaggedForReview: true,
      maxConfidence: 62,
      provider: "aws_rekognition",
      reason: "flagged",
      labels: [{ name: "Suggestive" }],
    });
    expect(summary).toEqual({
      status: "pending_review",
      flaggedForReview: true,
      maxConfidence: 62,
      provider: "aws_rekognition",
      reason: "flagged",
    });
    expect(summary.labels).toBeUndefined();
  });

  test("undefined when moderation did not run", () => {
    expect(moderationSummary({ applied: false })).toBeUndefined();
    expect(moderationSummary(null)).toBeUndefined();
  });
});
