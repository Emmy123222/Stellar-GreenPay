"use strict";

const { buildPdf, escapePdfText } = require("./pdf");

describe("escapePdfText", () => {
  test("escapes parentheses and backslashes", () => {
    expect(escapePdfText("a\\b(c)")).toBe("a\\\\b\\(c\\)");
  });

  test("maps non-ASCII characters to ASCII placeholders", () => {
    expect(escapePdfText("CO₂ offset")).toBe("CO? offset");
  });
});

describe("buildPdf", () => {
  test("produces a well-formed single-page PDF", () => {
    const buf = buildPdf([{ text: "Hello (world)", size: 14 }]);
    const text = buf.toString("latin1");

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Subtype /Type1");
    expect(text).toContain("(Hello \\(world\\))");
    expect(text).toContain("startxref");
  });

  test("writes a cross-reference entry for every object", () => {
    const text = buildPdf([{ text: "one" }, { text: "two" }]).toString("latin1");
    expect(text).toContain("xref\n0 6\n");
    expect(text).toContain("trailer");
  });
});
