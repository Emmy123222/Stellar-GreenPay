# Security Controls

Reference for the security controls implemented in the GreenPay backend and
contracts. For **reporting** a vulnerability, see [SECURITY.md](../SECURITY.md).

---

## File Upload Validation

Implemented in [`backend/src/routes/uploads.js`](../backend/src/routes/uploads.js).

### Threat model

The `Content-Type` header on a multipart upload is supplied by the client and
is **not trusted**. Validating against it allows an attacker to upload
executable content (`.php`, `.js`, `.sh`, `.exe`) while declaring
`image/png` or `application/pdf`, bypassing any MIME whitelist.

### Control: magic-byte detection

File type is determined by inspecting the file's **magic bytes** (file
signature) via the `file-type` library, never from the client-supplied header:

```js
const detectedMimeType = await detectMimeType(req.file.buffer);
```

Magic bytes are part of the file's actual content — an attacker cannot alter
them without corrupting the file they are trying to deliver.

| Type | Signature (hex) | ASCII |
|------|-----------------|-------|
| PDF  | `25 50 44 46`   | `%PDF` |
| PNG  | `89 50 4E 47`   | `.PNG` |
| JPEG | `FF D8 FF E0`   | — |
| GIF  | `47 49 46 38`   | `GIF8` |
| ZIP  | `50 4B 03 04`   | `PK` |
| EXE  | `4D 5A 90 00`   | `MZ` |

### Rules enforced

1. **Detection is mandatory.** A buffer whose type cannot be identified is
   rejected — corrupt and unknown formats do not get a pass.
2. **The detected type is checked against the whitelist**, not the declared one.
3. **The detected type is what gets stored**, so downstream consumers never see
   the client's claim.
4. **Header/content mismatches are logged** as suspicious even when the file is
   otherwise acceptable.

### Allowed types

`application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/gif`,
`application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
`application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`text/plain`, `text/csv`, `application/zip`.

### Limits

| Control | Value | Source |
|---------|-------|--------|
| Max file size | 10 MB | `UPLOAD_MAX_BYTES` env var |
| Files per request | 1 | multer `limits.files` |
| Upload rate limit | 20 per 15 min | `createRateLimiter(20, 15, "uploads")` |

### Error responses

| Status | Condition |
|--------|-----------|
| `400` | No file present in the `file` multipart field |
| `413` | File exceeds `UPLOAD_MAX_BYTES` |
| `415` | Type could not be detected from magic bytes |
| `415` | Detected type is not in the whitelist |

### Security log events

Structured events emitted for monitoring and alerting:

| Event | Meaning |
|-------|---------|
| `file_upload_rejected_unknown_type` | Magic-byte detection failed |
| `file_upload_rejected_unsupported_type` | Detected type not whitelisted |
| `file_upload_content_type_mismatch` | Declared header disagreed with detected type — possible spoofing attempt |
| `file_type_detection_error` | Detection threw; treated as undetectable |

A sustained rate of `file_upload_content_type_mismatch` from one source is a
strong signal of an active upload-bypass probe.

### Tests

```bash
cd backend && npm test -- src/routes/uploads.test.js
```

Coverage includes valid uploads for each allowed type, spoofed-`Content-Type`
attacks (PHP as PNG, JavaScript as PDF, shell scripts as images, Windows
executables as PDF), corrupt and empty files, size-limit enforcement, and
path-traversal protection on the download route.
