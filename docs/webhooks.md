# Webhooks — Stellar GreenPay

GreenPay can POST signed JSON notifications to a project owner's URL when fundraising milestones are reached. This guide covers the payload shape, signature verification, retry behavior, and how to register or rotate webhook secrets.

---

## Event types

| Event | When it fires |
|-------|----------------|
| `milestone.reached` | A project milestone percentage is crossed after a donation is recorded by the indexer |

Only `milestone.reached` is delivered today. Additional event types may be added later; always branch on the `event` field.

---

## Payload structure

Deliveries are `POST` requests with `Content-Type: application/json` and a JSON body:

```json
{
  "event": "milestone.reached",
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "milestone": "25% funded",
  "percentage": 25,
  "totalRaisedXLM": "12500.0000000",
  "timestamp": "2026-07-23T18:42:11.123Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event name (currently always `milestone.reached`) |
| `projectId` | string (UUID) | Project that reached the milestone |
| `milestone` | string | Milestone title |
| `percentage` | number | Milestone funding threshold (0–100) |
| `totalRaisedXLM` | string | Total raised XLM at delivery time (7 decimal places) |
| `timestamp` | string | ISO-8601 time when the payload was built |

**Request headers**

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `X-Webhook-Signature` | Hex-encoded HMAC-SHA256 of the raw request body |
| `User-Agent` | `GreenPay-Webhook/1.0` |

Delivery uses a **10 second** timeout. Your endpoint should respond quickly (ideally `2xx`) and process work asynchronously if needed.

---

## Verifying `X-Webhook-Signature`

GreenPay signs the **exact raw HTTP body** (the JSON string that was sent) with your project's webhook secret:

1. Read the raw request body as bytes/string (do not re-serialize parsed JSON).
2. Compute `HMAC-SHA256(secret, body)`.
3. Encode the digest as **lowercase hex** (no `sha256=` prefix).
4. Compare it to `X-Webhook-Signature` using a **timing-safe** equality check.

If the signatures do not match, reject the request (e.g. HTTP `401`).

### Node.js

```js
const crypto = require("crypto");

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader || "", "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express: use express.raw({ type: "application/json" }) for this route,
// or capture req.rawBody before JSON parsing.
app.post("/webhooks/greenpay", (req, res) => {
  const rawBody = req.body; // Buffer when using express.raw()
  const signature = req.get("X-Webhook-Signature");

  if (!verifyWebhookSignature(rawBody, signature, process.env.GREENPAY_WEBHOOK_SECRET)) {
    return res.status(401).send("invalid signature");
  }

  const payload = JSON.parse(rawBody.toString("utf8"));
  // handle payload.event ...
  res.status(200).send("ok");
});
```

### Python

```python
import hmac
import hashlib

def verify_webhook_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header or "")

# Flask example
from flask import Flask, request, abort

app = Flask(__name__)

@app.post("/webhooks/greenpay")
def greenpay_webhook():
    raw_body = request.get_data()
    signature = request.headers.get("X-Webhook-Signature", "")
    if not verify_webhook_signature(raw_body, signature, SECRET):
        abort(401)
    payload = request.get_json(force=True)
    # handle payload["event"] ...
    return ("ok", 200)
```

### Go

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
)

func verifyWebhookSignature(rawBody []byte, signatureHeader, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signatureHeader))
}

func greenpayWebhook(w http.ResponseWriter, r *http.Request) {
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	signature := r.Header.Get("X-Webhook-Signature")
	if !verifyWebhookSignature(rawBody, signature, secret) {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}
	// parse JSON from rawBody and handle event...
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}
```

---

## Retry schedule

If delivery fails (network error, timeout, or non-success response), GreenPay retries with this backoff:

| Attempt | Delay after previous attempt |
|---------|------------------------------|
| 1 | immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |
| 6 | 24 hours |

After the final attempt, the delivery is abandoned. Make your endpoint **idempotent**: the same `milestone.reached` event may be delivered more than once.

---

## Registering and rotating webhook secrets

### Register or update

```
POST /api/projects/:id/webhook
```

**Body**

```json
{
  "webhookUrl": "https://example.com/webhooks/greenpay",
  "adminAddress": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

| Field | Required | Rules |
|-------|----------|--------|
| `webhookUrl` | yes | Valid `http:` or `https:` URL |
| `adminAddress` | yes | Must match the project's `wallet_address` (owner only) |

**Success response**

```json
{
  "success": true,
  "data": {
    "webhookUrl": "https://example.com/webhooks/greenpay",
    "webhookSecret": "<64-character hex secret>"
  }
}
```

The `webhookSecret` is returned **only in this response**. Store it securely (environment variable, secrets manager). It is never exposed on project `GET` responses.

**Errors**

| Status | Meaning |
|--------|---------|
| `400` | Missing fields or invalid URL |
| `403` | `adminAddress` is not the project owner |
| `404` | Project not found |

### Rotate a secret

There is no separate rotate endpoint. Call `POST /api/projects/:id/webhook` again with the same or a new `webhookUrl`. Each successful call generates a **new** 32-byte secret (`crypto.randomBytes(32)` as hex) and invalidates the previous one.

After rotating:

1. Update your receiver with the new secret immediately.
2. Reject requests signed with the old secret.

---

## Security checklist

- Verify `X-Webhook-Signature` on every request before trusting the payload.
- Use the **raw body** for HMAC input — parsing then re-stringifying JSON can change whitespace and break verification.
- Prefer HTTPS webhook URLs in production.
- Treat the webhook secret like a password; rotate if it may have leaked.
- Respond quickly and process asynchronously so retries are not triggered by slow handlers.
