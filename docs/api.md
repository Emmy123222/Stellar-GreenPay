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

## Health
`GET /health` — Server status check.

---

## Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects` | List projects (`?category=&status=active&limit=50`) |
| GET | `/api/v1/projects/:id` | Get single project |

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
