/**
 * utils/pdf.js
 *
 * Minimal, dependency-free PDF writer.
 *
 * Enough to render a single-page, text-only document (used by the impact
 * certificate endpoint as the server-side fallback for browsers whose canvas
 * rendering is unreliable, e.g. Safari). Produces a valid PDF 1.4 file with a
 * cross-reference table so it opens in any viewer.
 */
"use strict";

const PAGE_WIDTH = 595; // A4 @ 72dpi
const PAGE_HEIGHT = 842;
const MARGIN = 64;
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_LEADING = 18;

/**
 * Escape a string for use inside a PDF literal string.
 * Maps common non-ASCII punctuation to ASCII so the standard Helvetica
 * (WinAnsi) encoding renders predictably without embedding a font.
 */
function escapePdfText(text) {
  return String(text == null ? "" : text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Build a one-page PDF from an array of text lines.
 *
 * @param {Array<{ text: string, size?: number, bold?: boolean, gap?: number }>} lines
 * @returns {Buffer}
 */
function buildPdf(lines = []) {
  const content = ["BT", `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`, `${DEFAULT_LEADING} TL`];

  for (const line of lines) {
    const text = escapePdfText(line.text);
    const size = line.size || DEFAULT_FONT_SIZE;
    if (line.gap) content.push(`0 -${line.gap} Td`);
    content.push(`/F1 ${size} Tf`);
    content.push(`(${text}) Tj`);
    content.push(`0 -${DEFAULT_LEADING} Td`);
  }

  content.push("ET");
  const contentStream = content.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

module.exports = { buildPdf, escapePdfText, PAGE_WIDTH, PAGE_HEIGHT };
