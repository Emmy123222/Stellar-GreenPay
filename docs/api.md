# API Reference — Stellar GreenPay

Base URL: `http://localhost:4000`

All responses: `{ "success": true, "data": {...} }` or `{ "error": "..." }`

---

## Versioning

All API routes are served under a version prefix: **`/api/v1`**. The version
prefix lets us ship breaking changes in a future `/api/v2` without disrupting
existing clients.

**Policy**

- Resource routes live under `/api/v1/<resource>` (e.g. `/api/v1/projects`).
- `/health` is unversioned (infrastructure/liveness check).
- New non-breaking fields may be added to a version without a bump. Breaking
  changes (removing/renaming fields, changing semantics) introduce a new
  version (`/api/v2`) and the previous version is supported until deprecated.
- **Legacy redirect:** unversioned `/api/v1/*` requests are answered with a
  `308 Permanent Redirect` to their `/api/v1/*` equivalent and carry a
  `Deprecation: true` header plus a
  `Link: </api/v1>; rel="successor-version"` header. The `308` status
  preserves the HTTP method and body, so existing `POST`/`PATCH` clients keep
  working. New clients should call `/api/v1` directly.

---

## Authentication

### Token format

Authenticated requests carry a **JWT** (HS256, signed with the server's
`JWT_SECRET`) in the standard authorization header:

```
Authorization: Bearer <token>
```

The token is opaque to clients — send it verbatim. A missing, malformed, or
expired token is answered with `401`:

| Response | Cause |
|----------|-------|
| `Missing or malformed Authorization header` | No `Authorization` header, or it does not start with `Bearer ` |
| `Token expired` | The JWT passed its `exp` claim |
| `Invalid token` | Signature verification failed (wrong secret, tampered token) |

### How to obtain a token

Admin sessions start with a username/password exchange:

```
POST /api/admin/login
Content-Type: application/json

{ "username": "admin", "password": "..." }
```

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 3600
  }
}
```

- **Access token (`token`)** — expires in **1 hour** (`expiresIn: 3600`).
- **Refresh token (`refreshToken`)** — expires in **24 hours**.
- Login is rate-limited (10 requests / 15 minutes / IP) and returns `503` if
  `ADMIN_PASSWORD` is not configured on the server.

### Refreshing an expired access token

When the access token expires, exchange the refresh token for a new one — no
need to re-enter credentials until the refresh token itself expires (24 h):

```
POST /api/admin/refresh
Content-Type: application/json

{ "refreshToken": "eyJhbGciOiJIUzI1NiIs..." }
```

```json
{ "success": true, "data": { "token": "eyJ...", "expiresIn": 3600 } }
```

The endpoint only accepts tokens minted as refresh tokens (`type: "refresh"`);
an access token sent here is rejected with `401 Invalid refresh token`, and an
expired one with `401 Invalid or expired refresh token`.

### Example request (curl)

```bash
# 1. Log in and extract the access token
TOKEN=$(curl -s -X POST http://localhost:4000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}' \
  | jq -r '.data.token')

# 2. Call an authenticated endpoint
curl -s http://localhost:4000/api/admin/me \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "success": true, "data": { "username": "admin", "role": "admin" } }
```

### Alternative admin credential: `X-Admin-Key`

Machine-to-machine admin callers may send `X-Admin-Key: <key>` instead of a
JWT. The header is compared in constant time against `ADMIN_API_KEY` /
`ADMIN_API_KEYS`. Admin routes that accept a Bearer token accept this header
too; if no admin key is configured the endpoint answers `503`.

> **Note:** `Authorization: Bearer` is reserved for JWTs — never put an admin
> API key there.

### Wallet-signed requests (project owners)

Project-owner routes (e.g. project webhooks) authenticate the caller's Stellar
wallet instead of a JWT, using a signed-challenge scheme in the spirit of
SEP-10:

| Header | Value |
|--------|-------|
| `X-Wallet-Address` | The project's `G...` public key |
| `X-Wallet-Challenge` | Arbitrary challenge string to sign |
| `X-Wallet-Signature` | Base64-encoded Ed25519 signature over the challenge |

When either challenge header is present, both must be present and must verify
against `X-Wallet-Address`; otherwise the request is rejected with `403
Forbidden`.

### Public vs. authenticated endpoints

| Access | Endpoints |
|--------|-----------|
| **Public** (no credentials) | `GET /health`, `GET /api/readiness`, `GET /metrics`, `GET /api/csrf-token`, `GET /api/projects*`, `GET /api/stats*`, `GET /api/impact*`, `GET /api/leaderboard*`, `GET /api/v1/profiles/:publicKey`, `POST /api/v1/donations`, `GET /api/v1/donations*`, `GET /api/v1/updates/:projectId`, `POST /api/verification-requests`, `GET /api/verification-requests/me`, `GET /api/verification-requests/:id` (with a matching `?wallet=G...`) |
| **Public** (credentials in body) | `POST /api/admin/login`, `POST /api/admin/refresh` |
| **Admin** (Bearer JWT or `X-Admin-Key`) | `/api/admin/*` (except `login`/`refresh`), `GET /api/verification-requests`, `GET /api/verification-requests/stats`, `PATCH /api/verification-requests/:id/status`, `DELETE /api/verification-requests/:id`, `POST /api/updates` (project updates), `POST /api/jobs/trigger`, `POST /api/projects/admin/register`, `POST /api/projects/admin/confirm`, `PATCH /api/projects/:id/webhook` |
| **Wallet owner** (`X-Wallet-*`) | `GET /api/webhooks/:projectId`, `GET /api/webhooks/:projectId/history` |

---
## Health
`GET /health` — Server status check.

---

## Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List projects with cursor pagination |
| GET | `/api/projects/:id` | Get single project |

### GET /api/projects — query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `20` | Page size (max 100) |
| `cursor` | string | — | Opaque cursor from `next_cursor` in a previous response |
| `category` | string | — | Filter by category (e.g. `Reforestation`) |
| `status` | string | — | Filter by status (`active`, `completed`, `paused`) |
| `verified` | `true` | — | Return only verified projects |
| `search` | string | — | Full-text search across name, description, location, tags |

### Pagination

The list endpoint uses **keyset (cursor) pagination** on `(created_at DESC, id DESC)`.
The first request is made without a `cursor`. Subsequent pages pass the `next_cursor`
value from the previous response.

**First page**
```
GET /api/projects?limit=20&status=active
```
```json
{
  "success": true,
  "data": [ ...20 projects... ],
  "next_cursor": "eyJjcmVhdGVkX2F0Ij...",
  "has_more": true
}
```

**Next page**
```
GET /api/projects?limit=20&status=active&cursor=eyJjcmVhdGVkX2F0Ij...
```

When `has_more` is `false` (or `next_cursor` is `null`), you have reached the last page.
Cursors are stable: inserting new projects does not shift pages already in flight.

### Project object
```json
{
  "id": "uuid",
  "name": "Amazon Reforestation Initiative",
  "description": "...",
  "category": "Reforestation",
  "location": "Brazil, South America",
  "walletAddress": "GABC...XYZ",
  "goalXLM": "50000.0000000",
  "raisedXLM": "18420.0000000",
  "donorCount": 147,
  "co2OffsetKg": 245000,
  "status": "active",
  "verified": true,
  "tags": ["reforestation", "amazon"],
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

---

## Donations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/donations` | Record a donation after on-chain tx |
| GET | `/api/v1/donations/project/:id` | Donations for a project (`?limit=20`) |
| GET | `/api/v1/donations/donor/:publicKey` | A donor's full history |

### POST /api/v1/donations
```json
{
  "projectId": "uuid",
  "donorAddress": "GABC...XYZ",
  "amountXLM": "25.0000000",
  "message": "For the Amazon 🌳",
  "transactionHash": "abc123...64hexchars"
}
```

Donations are **deduplicated by transactionHash** — safe to retry.

---

## Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/profiles/:publicKey` | Get donor profile + badges |
| POST | `/api/v1/profiles` | Create or update profile |

---

## Leaderboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/leaderboard` | Top donors by total XLM (`?limit=20`) |

### Leaderboard entry
```json
{
  "rank": 1,
  "publicKey": "GABC...XYZ",
  "displayName": "Alice",
  "totalDonatedXLM": "2500.0000000",
  "projectsSupported": 4,
  "topBadge": "earth"
}
```

---

## Project Updates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/updates/:projectId` | Updates posted by a project |

---

## Badge Tiers

| Tier | Threshold | Emoji |
|------|-----------|-------|
| `seedling` | ≥ 10 XLM | 🌱 |
| `tree` | ≥ 100 XLM | 🌳 |
| `forest` | ≥ 500 XLM | 🌲 |
| `earth` | ≥ 2,000 XLM | 🌍 |

---

## Verification Requests

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/verification-requests` | Public | Submit a new project verification request |
| GET | `/api/verification-requests/me` | Public (`?wallet=G...`) | Get submissions for a specific wallet address |
| GET | `/api/verification-requests/stats` | Admin | Aggregate counts by status for header metrics |
| GET | `/api/verification-requests/:id` | Public / Admin | Fetch details for a specific request ID |
| GET | `/api/verification-requests` | Admin | List all verification requests with status pagination |
| PATCH | `/api/verification-requests/:id/status` | Admin | Update request status and reviewer notes |

### GET /api/verification-requests/stats

Returns aggregate queue metrics grouped by status for admin header display:

```json
{
  "success": true,
  "data": {
    "pending": 5,
    "inReview": 2,
    "approved": 18,
    "rejected": 7
  }
}
```

