"use strict";

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
