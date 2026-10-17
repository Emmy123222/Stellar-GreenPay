"use strict";

// CJS shim for file-type (pure ESM in v18+) so Jest can require() it.
async function detect(buffer) {
  if (!buffer || buffer.length < 4) return undefined;
  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { ext: "pdf", mime: "application/pdf" };
  }
  // PNG: \x89PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  // JPEG: \xFF\xD8\xFF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  // WebP: RIFF....WEBP
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  // EXE: MZ
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) {
    return { ext: "exe", mime: "application/x-msdownload" };
  }
  // ZIP / DOCX: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  // GIF: GIF8
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { ext: "gif", mime: "image/gif" };
  }
  return undefined;
}

module.exports = {
  fromBuffer: detect,
  fileTypeFromBuffer: detect,
  fileTypeFromStream: async () => undefined,
  fileTypeStream: async (stream) => stream,
};
