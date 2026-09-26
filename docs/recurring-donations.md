# Recurring Donations

This document describes how recurring (monthly) donations work in Stellar GreenPay today, the tradeoffs of the current client-only storage approach, and the strategy for syncing recurring donation state to the backend when server-side support is added.

---

## Current State

Recurring donations are fully implemented in the **web frontend** and partially planned for the **mobile app**. The backend currently has no dedicated recurring-donations table — all subscription state lives in the client.

| Platform | Storage | Status |
|----------|---------|--------|
| Web (Next.js) | `window.localStorage` | ✅ Implemented |
| Mobile (React Native / Expo) | `AsyncStorage` (planned) | ⏳ Not yet implemented |
| Backend (PostgreSQL) | Dedicated table | ⏳ Not yet implemented |

---

## Data Model

The `MonthlySubscription` type is defined in [`frontend/utils/types.ts`](../frontend/utils/types.ts):

```typescript
export interface MonthlySubscription {
  id: string;                         // e.g. "sub_k3f2x8_1720000000000"
  projectId: string;                  // UUID of the target project
  projectName: string;                // Display name snapshot at creation time
  amountXLM: string;                  // Fixed decimal, e.g. "25.0000000"
  startDate: string;                  // ISO 8601, first due date
  durationMonths: number | null;      // null = indefinite; number = fixed term
  nextDueDate: string;                // ISO 8601, next payment due
  remainingMonths: number | null;     // null = indefinite; 0 = completed
  status: "active" | "completed";
  createdAt: string;                  // ISO 8601
  history: MonthlyDonationHistoryItem[];
}

export interface MonthlyDonationHistoryItem {
  paidAt: string;    // ISO 8601
  amountXLM: string;
}
```

**Key field behaviours:**

| Field | Rule |
|-------|------|
| `id` | Client-generated: `sub_<8 random chars>_<unix ms>`. Not a UUID; not globally unique across devices. |
| `durationMonths` | `null` means the subscription runs indefinitely until manually cancelled. A positive integer sets a fixed term. |
| `remainingMonths` | Decremented by 1 on each payment. When it reaches `0`, `status` is set to `"completed"` automatically. |
| `nextDueDate` | Advanced by exactly one calendar month after each payment (see `nextDueDate` calculation below). |
| `history` | Prepended — newest payment first. Sliced to 5 entries in the UI but the full array is stored. |

---

## Storage: localStorage vs AsyncStorage

### Web frontend — `window.localStorage`

The web frontend stores all subscription state in a single `localStorage` key:

```typescript
// frontend/lib/monthlyGiving.ts
export const MONTHLY_GIVING_STORAGE_KEY = "greenpay_monthly_subscriptions";
```

Reads and writes happen through `loadMonthlySubscriptions()` and `saveMonthlySubscriptions()`, which parse and serialise the full array as JSON on every call.

**Tradeoffs:**

| Concern | Detail |
|---------|--------|
| **Persistence** | Survives browser restarts and tab closes. Lost on explicit cache clear or private-browsing mode. |
| **Scope** | Per-origin (`localhost:3000` vs `greenpay.app` are separate). Subscriptions created on testnet are invisible on mainnet and vice versa. |
| **Size** | `localStorage` is capped at ~5 MB per origin. With `history` arrays, a single subscription is ≈ 200–400 bytes; the cap is not a practical concern today. |
| **Multi-device** | None — subscriptions created on one device or browser are invisible everywhere else. |
| **Concurrency** | `localStorage` is synchronous and single-threaded in the browser; no race conditions. |
| **Privacy** | The secret key is never stored. The subscription stores only public information (project ID, amount, dates). |
| **No server needed** | Works offline and requires no backend authentication. Low barrier to onboarding. |
| **No durability guarantee** | The user or browser can delete `localStorage` data at any time. There is no recovery path. |

### Mobile — AsyncStorage (planned)

The mobile app has `@react-native-async-storage/async-storage` installed (`^1.23.0` in `mobile/package.json`) but recurring donation scheduling is not yet implemented. When added, it should mirror the web pattern:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const RECURRING_KEY = 'greenpay_monthly_subscriptions';

async function loadSubscriptions(): Promise<MonthlySubscription[]> {
  const raw = await AsyncStorage.getItem(RECURRING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveSubscriptions(subs: MonthlySubscription[]): Promise<void> {
  await AsyncStorage.setItem(RECURRING_KEY, JSON.stringify(subs));
}
```

**AsyncStorage vs localStorage — key differences:**

| Concern | `localStorage` (web) | `AsyncStorage` (mobile) |
|---------|----------------------|------------------------|
| API | Synchronous | Asynchronous (Promise-based) |
| Storage location | Browser origin storage | App sandbox (iOS Keychain-adjacent; Android shared prefs) |
| Cleared by | Browser cache clear / private mode | App uninstall; explicit `AsyncStorage.clear()` |
| Cross-device | ❌ No | ❌ No |
| Capacity | ~5 MB | ~6 MB (iOS); ~6 MB (Android) |

The same multi-device limitation applies: subscriptions exist only on the device where they were created.

---

## `nextDueDate` Calculation and Timezone Handling

The next due date is computed by `addMonths()` in [`frontend/lib/monthlyGiving.ts`](../frontend/lib/monthlyGiving.ts):

```typescript
function addMonths(isoDate: string, months: number): string {
  const date = new Date(isoDate);
  const day = date.getUTCDate();       // preserve the original day-of-month
  date.setUTCDate(1);                  // move to 1st to avoid month-skipping
  date.setUTCMonth(date.getUTCMonth() + months);
  // clamp to last day of target month (handles Jan 31 → Feb 28/29, etc.)
  const maxDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, maxDay));
  return date.toISOString();
}
```

**How it works:**

1. The original day-of-month is saved (`day`).
2. The date is moved to the 1st to prevent overflow — e.g. adding 1 month to Jan 31 would otherwise land on March 3 (Feb has no day 31).
3. The UTC month is incremented by `months`.
4. The day is restored, clamped to the last day of the target month (`Math.min(day, maxDay)`).

**Examples:**

| `nextDueDate` | After `addMonths(..., 1)` | Note |
|--------------|--------------------------|------|
| `2026-01-31` | `2026-02-28` | February clamp (non-leap year) |
| `2026-01-31` | `2026-02-29` | February clamp (leap year) |
| `2026-03-31` | `2026-04-30` | April has 30 days |
| `2026-01-15` | `2026-02-15` | Normal case; no clamping needed |

**Timezone handling:**

All dates are stored and computed in **UTC**. The `startDate` entered by the user in the `MonthlyGivingSetup` component is converted to a full ISO 8601 UTC timestamp at creation:

```typescript
// frontend/components/MonthlyGivingSetup.tsx
const created = createMonthlySubscription({
  startDate: new Date(startDate).toISOString(), // converts local date picker → UTC ISO
  ...
});
```

The `new Date(startDate)` call for a `YYYY-MM-DD` string (from the `<input type="date">`) is interpreted as **midnight UTC** by the ECMAScript spec. This means a user selecting "2026-08-01" always creates `nextDueDate: "2026-08-01T00:00:00.000Z"`, regardless of the user's local timezone.

**Consequence:** The due-date check in `getDueMonthlySubscriptions()` compares UTC midnight against `Date.now()`, so a subscription scheduled for "August 1" fires as soon as the UTC clock crosses midnight on August 1 — which may be July 31 locally for users west of UTC.

> **Future improvement:** The backend sync design (below) should store `nextDueDate` as a `TIMESTAMPTZ` in PostgreSQL, preserving timezone-awareness and enabling server-side scheduling independent of the client's clock.

---

## Subscription Lifecycle

```
createMonthlySubscription()
        │
        ▼
  status: "active"
  nextDueDate: startDate
  remainingMonths: durationMonths (or null)
        │
        │  [user donates manually when due]
        │
        ▼
markMonthlySubscriptionPaid(id, amountXLM)
        │
        ├─ prepend to history[]
        ├─ decrement remainingMonths (if not null)
        ├─ advance nextDueDate by 1 month (addMonths)
        │
        ├─ remainingMonths > 0 or null ──► status stays "active"
        └─ remainingMonths === 0 ──────► status → "completed"
                                          nextDueDate frozen (not advanced)
```

**`getDueMonthlySubscriptions()`** returns all `active` subscriptions where `nextDueDate ≤ now`. The frontend currently does **not** automatically trigger a payment — it surfaces due subscriptions in the UI so the user can manually initiate the Stellar transaction. The actual XLM transfer goes through the standard `buildDonationTransaction()` + Freighter signing flow, and `markMonthlySubscriptionPaid()` is called only after the on-chain transaction succeeds.

---

## What Happens When a Project Is Paused or Deactivated

The recurring donation system currently has **no automatic response** to project status changes. The `MonthlySubscription` object stores only a `projectId` snapshot — it holds no reference to the project's live `status` field.

### Current behaviour

| Project status | Effect on subscription |
|----------------|------------------------|
| `active` | Normal — subscription fires as scheduled |
| `paused` / `deactivated` | **No change** — subscription remains `"active"` in localStorage; `getDueMonthlySubscriptions()` still returns it as due |
| Project deleted from DB | Donation attempt will fail when the backend rejects the `POST /api/donations` call (project not found) |

The `MonthlyGivingSetup` component shows the subscription's next due date but does not check the project's current status before displaying it.

### Recommended handling (future backend implementation)

When the backend sync is added (see next section), the sync endpoint should:

1. **Check project status** before scheduling a payment: if `status !== 'active'`, skip the subscription and return a `PROJECT_PAUSED` reason code.
2. **Propagate the pause** to the client: the sync response should include an `action: "skip" | "pause_subscription"` field so the mobile/web client can update the local subscription state.
3. **Re-enable automatically**: when a paused project returns to `active`, subscriptions with `status = "active"` should resume on the next due date without any user action.
4. **Handle project deletion**: if the project row no longer exists, mark the subscription `status = "cancelled"` (a new terminal state to add to the type).

---

## Backend Sync Strategy (Future)

The current client-only model works well for a single device but breaks down for:
- Users who switch devices or reinstall the app.
- Audit trails required for tax receipts.
- Server-side scheduling (cron jobs that trigger donations without the user opening the app).

### Proposed database schema

```sql
CREATE TABLE IF NOT EXISTS recurring_donations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_address     TEXT NOT NULL,            -- Stellar public key
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  amount_xlm        NUMERIC(20, 7) NOT NULL,
  frequency         TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (frequency IN ('monthly')),
  start_date        TIMESTAMPTZ NOT NULL,
  duration_months   INTEGER,                  -- NULL = indefinite
  next_due_date     TIMESTAMPTZ NOT NULL,
  remaining_months  INTEGER,                  -- NULL = indefinite; 0 = completed
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_donation_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_donation_id UUID NOT NULL REFERENCES recurring_donations(id) ON DELETE CASCADE,
  transaction_hash      TEXT NOT NULL UNIQUE,
  amount_xlm            NUMERIC(20, 7) NOT NULL,
  paid_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recurring_donations_donor_idx
  ON recurring_donations (donor_address);
CREATE INDEX IF NOT EXISTS recurring_donations_due_idx
  ON recurring_donations (next_due_date)
  WHERE status = 'active';
```

### Sync flow (client → server)

When backend support is added, the sync should use an **upsert-on-conflict** pattern keyed on `(donor_address, project_id, start_date)` to safely merge client-side subscriptions:

```
Client                               Backend
  │                                     │
  │  POST /api/recurring-donations      │
  │  { donorAddress, projectId,         │
  │    amountXLM, startDate,            │
  │    durationMonths, nextDueDate,     │
  │    history[] }                      │
  │ ──────────────────────────────────► │
  │                                     │  Upsert subscription row
  │                                     │  Insert new history entries
  │                                     │  (deduped by transaction_hash)
  │                                     │
  │  { id, nextDueDate, status,         │
  │    action: "ok" | "skip",           │
  │    skipReason?: "PROJECT_PAUSED" }  │
  │ ◄────────────────────────────────── │
  │                                     │
  │  Client updates localStorage /      │
  │  AsyncStorage with server id        │
```

**Conflict resolution rules:**

| Conflict | Resolution |
|----------|------------|
| Same `(donor_address, project_id, start_date)` already exists | Update `next_due_date`, `remaining_months`, `status` if client is newer (`updated_at`) |
| Client `history` entries not in DB | Insert new `recurring_donation_payments` rows (skip if `transaction_hash` already exists) |
| Server subscription is `completed` or `cancelled`; client says `active` | Trust server — return server status and client updates local record |

### Migration from client-only to server-synced

The migration should be **additive and non-breaking**:

1. The client continues to maintain the local `localStorage` / `AsyncStorage` copy as a cache.
2. On app load (or after each successful payment), the client calls `POST /api/recurring-donations/sync` to push local state up and pull any server-side updates down.
3. The server assigns a stable UUID (`id`) to each subscription. The client replaces the locally-generated `sub_xxx_yyy` id with the server UUID after first sync.
4. Once server-side scheduling is stable, an opt-in "server-managed" mode can be introduced where the cron job triggers the payment via a push notification instead of relying on the user opening the app.

---

## Code Reference

| File | Purpose |
|------|---------|
| `frontend/lib/monthlyGiving.ts` | Core subscription logic: `createMonthlySubscription`, `markMonthlySubscriptionPaid`, `getDueMonthlySubscriptions`, `addMonths` |
| `frontend/components/MonthlyGivingSetup.tsx` | UI for creating and viewing subscriptions; duration picker (3 / 6 / 12 months / indefinite) |
| `frontend/utils/types.ts` | `MonthlySubscription` and `MonthlyDonationHistoryItem` TypeScript types |
| `mobile/package.json` | `@react-native-async-storage/async-storage` dependency (storage layer for future mobile implementation) |
| `backend/src/db/schema.sql` | Current schema — no recurring_donations table yet |

---

## Related Documentation

- [Architecture Overview](./architecture.md) — System diagram and key design decisions
- [API Reference](./api.md) — Full REST API reference for donations
- [Getting Started](./getting-started.md) — Local development setup
