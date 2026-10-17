"use strict";

async function fileTypeFromBuffer(buffer) {
  if (!buffer || buffer.length < 2) return undefined;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  // PDF: %PDF (25 50 44 46)
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { ext: "pdf", mime: "application/pdf" };
  }

  // GIF: GIF87a or GIF89a (47 49 46 38)
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { ext: "gif", mime: "image/gif" };
  }

  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }

  // EXE: MZ (4D 5A)
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
    return { ext: "exe", mime: "application/x-msdownload" };
  }

  // ZIP / DOCX: PK\x03\x04 (50 4B 03 04)
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return { ext: "zip", mime: "application/zip" };
  }

  return undefined;
}

module.exports = {
  fileTypeFromBuffer,
  fromBuffer: fileTypeFromBuffer,
  fileTypeFromStream: async () => undefined,
  fileTypeStream: async (stream) => stream,
};
