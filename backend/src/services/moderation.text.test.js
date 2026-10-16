"use strict";
/**
 * Unit tests for moderation.moderateText() — donor comment rules (#1662).
 */

const moderation = require("./moderation");

const ENV_KEYS = [
  "COMMENT_MODERATION_ENABLED",
  "COMMENT_MODERATION_BLOCKLIST",
  "COMMENT_MODERATION_REVIEW_TERMS",
  "COMMENT_MODERATION_MAX_LINKS",
];

const savedEnv = {};
beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("moderateText", () => {
  it("approves ordinary comments", () => {
    const v = moderation.moderateText({ text: "So glad to support this reforestation work 🌱" });
    expect(v).toMatchObject({
      applied: true,
      blocked: false,
      status: "approved",
      flaggedForReview: false,
      provider: moderation.TEXT_PROVIDER,
    });
  });

  it("rejects anything that looks like a Stellar secret seed", () => {
    const v = moderation.moderateText({ text: `oops S${"B".repeat(55)}` });
    expect(v.blocked).toBe(true);
    expect(v.status).toBe("rejected");
    expect(v.labels).toEqual(["stellar_secret_key"]);
  });

  it("does not mistake a public key for a secret", () => {
    const v = moderation.moderateText({ text: `send to G${"B".repeat(55)}` });
    expect(v.blocked).toBe(false);
  });

  it.each(["Share your SEED PHRASE here", "validate your wallet now", "Double your XLM today"])(
    "rejects built-in scam phrase: %s",
    (text) => {
      const v = moderation.moderateText({ text });
      expect(v.blocked).toBe(true);
      expect(v.labels[0]).toMatch(/^term:/);
    },
  );

  it("rejects configured blocklist terms", () => {
    process.env.COMMENT_MODERATION_BLOCKLIST = "badword, other";
    expect(moderation.moderateText({ text: "this is a BadWord" }).blocked).toBe(true);
    expect(moderation.moderateText({ text: "fine" }).blocked).toBe(false);
  });

  it("flags links for review by default", () => {
    const v = moderation.moderateText({ text: "see www.example.com" });
    expect(v).toMatchObject({ blocked: false, status: "pending_review", flaggedForReview: true });
    expect(v.labels).toEqual(["links"]);
  });

  it("allows links up to COMMENT_MODERATION_MAX_LINKS", () => {
    process.env.COMMENT_MODERATION_MAX_LINKS = "1";
    expect(moderation.moderateText({ text: "https://a.example" }).status).toBe("approved");
    expect(moderation.moderateText({ text: "https://a.example https://b.example" }).status).toBe("pending_review");
  });

  it("flags configured review terms and shouting", () => {
    process.env.COMMENT_MODERATION_REVIEW_TERMS = "refund";
    expect(moderation.moderateText({ text: "I want a refund" }).labels).toEqual(["term:refund"]);
    expect(moderation.moderateText({ text: "THIS PROJECT IS AMAZING I LOVE IT" }).labels).toEqual(["shouting"]);
    expect(moderation.moderateText({ text: "OK" }).status).toBe("approved");
  });

  it("skips when disabled", () => {
    process.env.COMMENT_MODERATION_ENABLED = "false";
    const v = moderation.moderateText({ text: "seed phrase" });
    expect(v).toMatchObject({ applied: false, blocked: false, status: "skipped" });
  });

  it("produces a moderationSummary like image verdicts", () => {
    const v = moderation.moderateText({ text: "https://x.example" });
    expect(moderation.moderationSummary(v)).toEqual({
      status: "pending_review",
      flaggedForReview: true,
      maxConfidence: 100,
      provider: moderation.TEXT_PROVIDER,
      reason: "The comment is awaiting moderator review.",
    });
  });
});
