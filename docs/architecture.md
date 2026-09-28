# Architecture — Stellar GreenPay

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          User's Browser                             │
│  ┌────────────────────────────┐   ┌────────────────────────────┐   │
│  │  Next.js Frontend          │   │  Freighter Extension       │   │
│  │  (React + Tailwind)        │◄─►│  (Stellar Wallet)          │   │
│  └──────────┬─────────────────┘   └────────────────────────────┘   │
└─────────────┼───────────────────────────────────────────────────────┘
              │ REST API (non-critical path)
              ▼
┌─────────────────────────────┐
│  Node.js Backend (Express)  │
│                             │
│  • Project metadata         │
│  • Donation record keeping  │
│  • Leaderboard aggregation  │
│  • Profile management       │
│  • Project updates feed     │
└──────────────┬──────────────┘
               │ Horizon REST
               ▼
┌─────────────────────────────┐     ┌──────────────────────────────┐
│  Stellar Horizon API        │◄───►│  Stellar Network             │
│  (horizon-testnet           │     │  (Validators)                │
│   .stellar.org)             │     │                              │
└─────────────────────────────┘     └──────────────────────────────┘
                                               ▲
                                               │ Soroban
                                  ┌────────────────────────────────┐
                                  │  GreenPay Donation Contract    │
                                  │  (Rust/WASM)                   │
                                  │                                │
                                  │  register_project()            │
                                  │  donate()                      │
                                  │  get_donor_stats()             │
                                  │  get_badge()                   │
                                  │  get_global_total()            │
                                  │  get_global_co2()              │
                                  └────────────────────────────────┘
```

## Donation Flow

```
Donor selects amount ──► buildDonationTransaction()
                                    │
                                    ▼
                         Freighter signs tx
                                    │
                                    ▼
                    submitTransaction() → Horizon
                                    │
                                    ▼
                    XLM sent directly to project wallet
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
              recordDonation()           Soroban donate()
              (backend)                  (on-chain record)
                        │                       │
                        └───────────┬───────────┘
                                    ▼
                        Leaderboard + badge updated
```

## Key Design Decisions

### Direct-to-project payments
Donations go straight to the project wallet via a standard Stellar payment. The contract records the event but does not custody funds — this maximises trust and minimises attack surface.

### Backend as optional layer
The Node.js backend provides project metadata, the leaderboard, and the update feed. If the backend is unavailable, core donations still work — users just can't see the leaderboard or feed.

### Soroban as the source of truth
The contract is the immutable, auditable record of all donations. Anyone can verify total raised, donor stats, and CO₂ offsets without trusting the backend.

### Community features
The leaderboard and donation feed create social accountability — donors can see their rank and impact publicly, encouraging more giving.

## Security

| Concern | Mitigation |
|---------|-----------|
| Private key exposure | Freighter signs locally — keys never touch the app |
| Fake donation records | Backend deduplicates by tx hash; contract is ground truth |
| Project wallet spoofing | Admin must register projects on-chain via Soroban |
| Sybil donors | On-chain stats cannot be faked — all linked to real wallet |
| Backend downtime | Donations still work — backend is not on the critical path |

### CSRF Strategy

The backend uses **cookie-based CSRF protection** (`csurf`) for browser clients and **selective exemption** for non-browser clients that cannot participate in the cookie/token handshake.

#### How it works

The `selectiveCsrf` middleware (`backend/src/middleware/selectiveCsrf.js`) wraps `csurf` with a path-based routing decision:

```
incoming request
       │
       ▼
 isCsrfExempt(req.path)?
  ├─ YES → skip csurf → next()
  └─ NO  → csurf validates X-CSRF-Token header
                │
                ├─ valid   → next()
                └─ invalid → 403 ForbiddenError
```

#### Exempt paths

| Prefix / Path | Client type | Reason for exemption |
|---|---|---|
| `/api/mobile/*` | React Native app | No browser cookie jar; uses `Authorization: Bearer` JWT |
| `/api/extension/*` | Freighter companion extension | Service-worker context; no access to main-frame cookies |
| `/api/notifications*` | SSE push streams | Long-lived GET streams; no mutation |
| `/health`, `/api/health`, `/api/v1/health`, `/api/readiness` | Infrastructure probes | No mutation; no browser context |

#### Protected paths

All other routes (`/api/projects`, `/api/donations`, `/api/ratings`, `/api/uploads`, etc.) require a valid CSRF token obtained from `GET /api/csrf-token` or `GET /api/v1/csrf-token`.

Browser clients must:
1. `GET /api/csrf-token` — server sets the CSRF cookie and returns `{ csrfToken }` in the body.
2. Include `X-CSRF-Token: <token>` on every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`).

#### Mobile / Extension clients

Mobile (React Native) and extension clients use the `/api/mobile/*` and `/api/extension/*` prefixes respectively. These route to the same underlying handlers — there is no logic duplication. Authentication is handled separately via `Authorization: Bearer <jwt>` or Stellar wallet-signature headers.

#### Security trade-off

Skipping CSRF for non-browser prefixes is safe because:
- CSRF is a browser-specific attack vector (the browser auto-attaches cookies to cross-site requests).
- Native and extension clients do not have a cookie jar shared with an attacker-controlled page.
- The mobile/extension endpoints are still protected by rate-limiting, input validation, and any auth middleware on individual routes.

The exempt prefix list is an explicit allowlist in `isCsrfExempt()` — new routes are CSRF-protected by default unless explicitly added.
