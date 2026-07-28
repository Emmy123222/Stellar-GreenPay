# Webhook Secret Rotation

This document explains how to rotate your project's webhook secret on Stellar GreenPay, the 24-hour grace period, and what consumers need to do to migrate.

---

## Overview

Every project that registers a webhook URL has a `webhook_secret` that GreenPay uses to sign outgoing milestone notifications. When you rotate this secret:

- A **new secret** is generated immediately and returned to you.
- The **old secret remains valid for exactly 24 hours** — the grace period.
- During the grace period, **every webhook delivery is signed with both secrets** so that consumers using either key continue to validate successfully.
- After 24 hours the old secret is permanently ignored; only the new secret is accepted.

No manual cleanup is required. Expiry is enforced automatically on every request by comparing timestamps.

---

## Rotating the Secret

### Endpoint

```
POST /api/projects/:id/webhook-secret/rotate
POST /api/projects/:id/rotate-webhook-secret   (alias)
```

### Authorization

Either:
- `X-Admin-Key` header with a configured admin API key, **or**
- JSON body field `adminAddress` equal to the project's `wallet_address` (owner self-service).

### Request

```json
{
  "adminAddress": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "projectId": "8d9ac19b-52eb-42f7-80d9-19a88ba59e43",
    "webhookSecret": "whsec_a3f82c1de4b5...",
    "rotatedAt": "2026-07-28T15:30:00.000Z",
    "previousSecretExpiresAt": "2026-07-29T15:30:00.000Z",
    "expiresAt": "2026-07-29T15:30:00.000Z",
    "gracePeriodActive": true
  }
}
```

| Field | Description |
|---|---|
| `webhookSecret` | New active secret. **Store this securely — it will not be returned again.** |
| `rotatedAt` | Timestamp when the rotation was performed. |
| `previousSecretExpiresAt` | When the old secret stops being accepted (24h after rotation). |
| `gracePeriodActive` | `true` while the old secret is still valid. |

> [!CAUTION]
> The `webhookSecret` value is returned **only at rotation time**. It is stored hashed and cannot be retrieved later. If you lose it, rotate again.

> [!WARNING]
> `previousWebhookSecret` is never exposed in any API response. Only the new secret is returned.

---

## Dual-Signature Delivery During the Grace Period

When a grace period is active, GreenPay sends **two signatures** with every webhook POST:

```
X-Webhook-Signature: <sig-with-new-secret>, <sig-with-old-secret>
X-Webhook-Signature-Previous: <sig-with-old-secret>
```

This means:

- Consumers **already using the new secret** validate against the first signature.
- Consumers **still using the old secret** validate against the second signature (or the `X-Webhook-Signature-Previous` header).
- **No consumer experiences an interruption** during the 24-hour window.

After the grace period expires, only a single `X-Webhook-Signature` is sent (signed with the new secret).

---

## Consumer Migration Guide

### Step 1 — Receive both secrets from your platform admin

The project owner rotates the secret and shares the new `webhookSecret` value with you securely (e.g. via your secrets manager).

### Step 2 — Update your signature verification

Update your webhook handler to accept **either** the new or old secret during the grace period:

```js
const crypto = require("crypto");

function verifyWebhookSignature(body, headers, currentSecret, previousSecret) {
  // Accept comma-separated or array form
  const rawSig = headers["x-webhook-signature"] || "";
  const signatures = rawSig.split(",").map(s => s.trim()).filter(Boolean);

  const expected = (secret) =>
    crypto.createHmac("sha256", secret).update(body).digest("hex");

  for (const sig of signatures) {
    if (timingSafeEqual(sig, expected(currentSecret))) return true;
    if (previousSecret && timingSafeEqual(sig, expected(previousSecret))) return true;
  }
  return false;
}

function timingSafeEqual(a, b) {
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}
```

### Step 3 — Remove the old secret after 24 hours

Once `previousSecretExpiresAt` has passed, remove the old secret from your configuration. Any delivery signed only with the old secret will be rejected by GreenPay's outbound signing, and you should reject it too.

---

## Incoming Signature Verification (Inbound Webhooks)

If your integration sends signed payloads *back* to GreenPay (not common, but supported):

- **During the grace period:** GreenPay accepts signatures generated with either the current or previous secret.
- **After expiry:** Only signatures from the current secret are accepted.
- All comparisons use **constant-time equality** to prevent timing side-channels.

---

## Grace Period Edge Cases

| Scenario | Behaviour |
|---|---|
| Rotate while a grace period is already active | The currently-active secret becomes the new "previous secret" with a fresh 24h window. The prior previous secret is discarded. |
| Rotate when no secret existed before | No grace period is created (`gracePeriodActive: false`). The new secret is the only valid secret immediately. |
| Rotate after the previous grace period expired | The expired previous secret is overwritten. A fresh 24h window starts for the old current secret. |
| Rotation at the exact 24h boundary | Boundary is exclusive — at exactly `previousSecretExpiresAt` the previous secret is **invalid**. |

---

## Security Properties

- Secrets are never logged.
- Previous secrets are never exposed in API responses.
- Constant-time comparison is used everywhere to prevent timing attacks.
- Secret format: `whsec_` prefix followed by 48 hex characters (24 random bytes).
- Authorization follows existing project-owner (`wallet_address` match) and admin-key conventions.
