# Escrow Workflow — Jobs

This document describes the end-to-end lifecycle of an escrow job in Stellar GreenPay: from off-chain record creation through on-chain escrow funding, work delivery, client approval, and final payment release to the freelancer.

---

## Overview

The jobs system pairs two layers:

| Layer | What it does |
|-------|--------------|
| **Off-chain** (PostgreSQL + REST API) | Stores job metadata, status, and the release transaction hash |
| **On-chain** (Soroban escrow contract) | Holds funds in escrow; enforces that only the original client can release them to the freelancer |

The off-chain and on-chain records share the same `job_id` (UUID). The backend never calls the contract directly — the frontend builds and submits contract invocations using the Stellar Soroban SDK, then reports the resulting transaction hash back to the backend.

---

## Architecture

```
  Client Browser (Next.js)
  ┌─────────────────────────────────────────────────────────────────────┐
  │  pages/jobs/[id].tsx                                                 │
  │                                                                      │
  │  1. fetchJob(id)         ──────────────────► GET /api/jobs/:id       │
  │  2. buildReleaseEscrowTransaction()  (Soroban SDK, local)            │
  │  3. signTransactionWithWallet()      (Freighter extension)           │
  │  4. submitTransaction(signedXDR)  ──► Stellar Horizon / Soroban RPC  │
  │  5. completeJobRelease(id, txHash) ─► PATCH /api/jobs/:id/release    │
  └─────────────────────────────────────────────────────────────────────┘
              │                                        │
              ▼                                        ▼
  ┌───────────────────────┐            ┌──────────────────────────────┐
  │  Node.js Backend      │            │  Stellar Network             │
  │  (Express, Port 4000) │            │                              │
  │                       │            │  EscrowContract (Soroban)    │
  │  GET  /api/jobs        │            │  ┌────────────────────────┐ │
  │  GET  /api/jobs/:id    │            │  │ create_job(...)        │ │
  │  PATCH /api/jobs/:id/  │            │  │ release_escrow(...)    │ │
  │        release         │            │  │ get_job(...)           │ │
  │                       │            │  └────────────────────────┘ │
  │  PostgreSQL            │            └──────────────────────────────┘
  │  (jobs table)          │
  └───────────────────────┘
```

---

## Step-by-Step Workflow

### Step 1 — Client Creates a Job (off-chain record + on-chain escrow)

Job creation is a two-part action performed manually or by a client-side form:

**1a. Record the job in the database**

A row is inserted directly into the `jobs` table (see [`backend/src/db/schema.sql`](../backend/src/db/schema.sql)):

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id                     UUID PRIMARY KEY,
  title                  TEXT NOT NULL,
  description            TEXT NOT NULL,
  client_public_key      TEXT NOT NULL,
  freelancer_public_key  TEXT NOT NULL,
  amount_escrow_xlm      NUMERIC(20, 7) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'in_escrow',
  release_transaction_hash TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The initial `status` is `'in_escrow'` — the database record assumes the on-chain escrow will be funded before the freelancer starts work.

**1b. Fund on-chain escrow via `create_job`**

The client invokes `create_job` on the deployed `EscrowContract` (see [`contracts/escrow-contract/src/lib.rs`](../contracts/escrow-contract/src/lib.rs)):

```rust
pub fn create_job(
    env: Env,
    client: Address,
    freelancer: Address,
    job_id: String,     // must match the database UUID
    token: Address,     // XLM token contract address
    amount: i128,       // in stroops (1 XLM = 10_000_000 stroops)
)
```

- The client wallet **must authorise** this call (`client.require_auth()`).
- The contract transfers `amount` of the specified token from the client's account into the contract itself.
- The job is stored in Soroban instance storage under `DataKey::Job(job_id)` with `status: JobStatus::Escrowed`.
- Calling `create_job` with a duplicate `job_id` panics — each job ID is unique on-chain.

> **Environment variable:** The frontend reads `NEXT_PUBLIC_ESCROW_CONTRACT_ID` to locate the deployed contract. If this is unset, the "Approve & release payment" button is hidden and a warning banner is shown.

---

### Step 2 — Freelancer Views Jobs

The freelancer browses available jobs via the frontend job listing page ([`frontend/pages/jobs/index.tsx`](../frontend/pages/jobs/index.tsx)) which calls:

```typescript
// lib/api.ts
export async function fetchJobs(): Promise<EscrowJob[]>
// → GET /api/jobs
```

The backend returns the 50 most recent jobs ordered by creation date:

```js
// backend/src/routes/jobs.js
router.get("/", async (req, res, next) => {
  const result = await pool.query(
    "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50"
  );
  res.json({ success: true, data: result.rows.map(mapJobRow) });
});
```

Each job in the list shows the title, current status, and escrow amount. The freelancer clicks a job to view its detail page.

**Job object shape** (TypeScript — [`frontend/utils/types.ts`](../frontend/utils/types.ts)):

```typescript
export interface EscrowJob {
  id: string;
  title: string;
  description: string;
  clientPublicKey: string;
  freelancerPublicKey: string;
  amountEscrowXlm: string;
  status: "draft" | "in_escrow" | "completed";
  releaseTransactionHash?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

---

### Step 3 — Freelancer Completes Work, Client Reviews

Work delivery and review happen off-platform (e.g., via direct communication). The platform does not model a "submitted for review" state — the freelancer delivers their work, the client verifies it satisfies the agreed scope, and then proceeds to Step 4.

---

### Step 4 — Client Approves Release (on-chain + off-chain)

This is the most complex step. The client visits the job detail page ([`frontend/pages/jobs/[id].tsx`](../frontend/pages/jobs/%5Bid%5D.tsx)) and clicks **"Approve & release payment"**. The frontend executes five ordered steps:

```
building → signing → submitting → recording → success
```

#### 4a. Build the release transaction

```typescript
// lib/stellar.ts
const tx = await buildReleaseEscrowTransaction({
  contractId: ESCROW_CONTRACT_ID,  // NEXT_PUBLIC_ESCROW_CONTRACT_ID
  jobId: job.id,                   // database UUID = on-chain job_id
  clientAddress: publicKey,        // connected Freighter wallet
});
```

Internally, this:
1. Loads the client account from Horizon to get the current sequence number.
2. Builds a `TransactionBuilder` that calls `release_escrow(client, job_id)` on the escrow contract with a fee of `1,000,000` stroops.
3. Simulates the transaction via the Soroban RPC (`NEXT_PUBLIC_SOROBAN_RPC_URL`) to populate resource fees and footprint.
4. Returns an assembled, unsigned transaction ready for signing.

#### 4b. Sign with Freighter

```typescript
// lib/wallet.ts
const { signedXDR, error } = await signTransactionWithWallet(tx.toXDR());
```

The Freighter browser extension presents the transaction to the user for approval. No private key ever leaves the browser.

#### 4c. Submit to the network

```typescript
// lib/stellar.ts
const result = await submitTransaction(signedXDR);
const hash = result.hash;  // 64-character hex transaction hash
```

`submitTransaction` submits the signed XDR to Stellar Horizon (`NEXT_PUBLIC_HORIZON_URL`). On success, Horizon returns the transaction hash.

The Soroban contract then executes `release_escrow`:

```rust
pub fn release_escrow(env: Env, client: Address, job_id: String) {
    client.require_auth();
    let mut job: Job = env.storage().instance()
        .get(&DataKey::Job(job_id.clone()))
        .expect("Job not found");

    if job.client != client      { panic!("Only the client can release"); }
    if job.status != JobStatus::Escrowed { panic!("Already released"); }

    // Transfer escrowed funds to the freelancer
    let token_client = token::Client::new(&env, &job.token);
    token_client.transfer(&contract_addr, &job.freelancer, &job.amount);

    job.status = JobStatus::Released;
    env.storage().instance().set(&DataKey::Job(job_id), &job);
}
```

The contract enforces:
- Only the original `client` address can call release.
- The job must be in `Escrowed` state (panics if already `Released`).
- Funds are sent atomically to the `freelancer` address stored at job creation.

#### 4d. Record the release in the backend

```typescript
// lib/api.ts
const updated = await completeJobRelease(job.id, hash);
// → PATCH /api/jobs/:id/release  { releaseTransactionHash: hash }
```

The backend validates the hash format (64 hex characters), checks the job exists and has `status = 'in_escrow'`, then updates the row:

```js
// backend/src/routes/jobs.js
router.patch("/:id/release", async (req, res, next) => {
  const { releaseTransactionHash } = req.body;
  validateTxHash(releaseTransactionHash);  // rejects non-64-char hex

  // Guard: job must exist and be in_escrow
  if (found.rows[0].status !== "in_escrow") {
    throw { status: 400, message: "Job is not awaiting release" };
  }

  const updated = await pool.query(
    `UPDATE jobs
     SET status = 'completed',
         release_transaction_hash = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [releaseTransactionHash, req.params.id]
  );
  res.json({ success: true, data: mapJobRow(updated.rows[0]) });
});
```

> **Resilience:** If the backend `PATCH` call fails after the on-chain release has already succeeded, the frontend detects the error, updates the local UI state to `completed`, and shows a sync warning with the transaction hash. The freelancer has already received the funds on-chain. The off-chain record can be reconciled manually by replaying the `PATCH` with the saved hash.

---

### Step 5 — Funds Released to Freelancer Wallet

Once `release_escrow` executes on-chain:

- The XLM (or configured token) moves from the escrow contract's account to `freelancer_public_key`.
- The Soroban storage record updates `job.status` to `Released`.
- The backend `jobs` row updates to `status = 'completed'` with the `release_transaction_hash`.
- The frontend shows a success banner with a Stellar Expert explorer link for the transaction.

The freelancer can verify receipt by checking their Freighter balance or browsing to:
```
https://stellar.expert/explorer/testnet/tx/<release_transaction_hash>
```

---

## Status Transitions

```
            create_job (on-chain)
                    │
                    ▼
              ┌──────────┐
              │ in_escrow │  ← initial state after DB insert
              └──────────┘
                    │
          release_escrow (on-chain)
          + PATCH /api/jobs/:id/release
                    │
                    ▼
              ┌───────────┐
              │ completed  │
              └───────────┘
```

| Status | Description |
|--------|-------------|
| `in_escrow` | Funds are locked in the Soroban contract; work is in progress |
| `completed` | `release_escrow` executed on-chain; `release_transaction_hash` recorded in the DB |

> **Note:** A `draft` status exists in the TypeScript type (`EscrowJobStatus`) to support future pre-funding flows, but the current backend always inserts jobs with `status = 'in_escrow'`.

---

## API Reference

### `GET /api/jobs`

Returns the 50 most recent escrow jobs.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Build landing page",
      "description": "Responsive Next.js landing page with Tailwind...",
      "clientPublicKey": "GCLIENT...XYZ",
      "freelancerPublicKey": "GFREELANCER...ABC",
      "amountEscrowXlm": "500.0000000",
      "status": "in_escrow",
      "releaseTransactionHash": null,
      "createdAt": "2026-07-01T10:00:00.000Z",
      "updatedAt": "2026-07-01T10:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/jobs/:id`

Returns a single job by UUID.

**Response:** Same shape as above, single `data` object.

**Error (404):**
```json
{ "error": "Job not found" }
```

---

### `PATCH /api/jobs/:id/release`

Marks a job as completed after the client has executed `release_escrow` on-chain.

**Request body:**
```json
{
  "releaseTransactionHash": "a1b2c3...64hexchars"
}
```

**Validation:**
- `releaseTransactionHash` must be exactly 64 hexadecimal characters.
- Job must exist and have `status = 'in_escrow'`.

**Success response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "releaseTransactionHash": "a1b2c3...64hexchars",
    "updatedAt": "2026-07-15T14:23:01.000Z",
    ...
  }
}
```

**Error responses:**

| Status | Message |
|--------|---------|
| 400 | `"Invalid transaction hash"` — hash not 64 hex chars |
| 400 | `"Job is not awaiting release"` — status ≠ `in_escrow` |
| 404 | `"Job not found"` |

---

## Soroban Contract Reference

Contract source: [`contracts/escrow-contract/src/lib.rs`](../contracts/escrow-contract/src/lib.rs)

| Function | Auth required | Description |
|----------|---------------|-------------|
| `create_job(env, client, freelancer, job_id, token, amount)` | `client` | Locks `amount` of `token` from `client` into the contract |
| `release_escrow(env, client, job_id)` | `client` | Transfers locked funds to `freelancer`; marks job `Released` |
| `get_job(env, job_id)` | None | Read-only query; returns `Option<Job>` |

**On-chain `Job` struct:**

```rust
pub struct Job {
    pub id: String,
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub status: JobStatus,   // Escrowed | Released
}
```

**Deployment:**

The escrow contract is separate from the GreenPay donation contract. Deploy it using:

```bash
cd contracts/escrow-contract
cargo build --target wasm32-unknown-unknown --release

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm \
  --source <IDENTITY> \
  --network testnet
```

Set the returned contract ID in both environment files:

```bash
# frontend/.env.local
NEXT_PUBLIC_ESCROW_CONTRACT_ID=<CONTRACT_ID>
```

---

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `NEXT_PUBLIC_ESCROW_CONTRACT_ID` | Frontend | Deployed Soroban escrow contract ID |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Frontend | Soroban RPC endpoint (default: `https://soroban-testnet.stellar.org`) |
| `NEXT_PUBLIC_HORIZON_URL` | Frontend | Horizon endpoint for account loading and submission |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Frontend | `testnet` or `mainnet` (affects network passphrase and explorer links) |
| `DATABASE_URL` | Backend | PostgreSQL connection string |

---

## Error Handling

### On-chain errors (simulation)

`buildReleaseEscrowTransaction` simulates the contract call before signing. If simulation fails, it throws a user-facing message (see `formatSimulationFailure` in `lib/stellar.ts`):

| Contract panic | User-facing message |
|----------------|---------------------|
| `"Job not found"` | Fund this job with `create_job` using the same job ID |
| `"Only the client can release"` | Connect the client wallet |
| `"Already released"` | Escrow was already released on-chain |
| Underfunded | Insufficient XLM for Soroban fees |

### Backend sync failure

If the on-chain release succeeds but the backend `PATCH` fails (e.g., network timeout), the frontend:

1. Optimistically updates the local job state to `completed` with the hash.
2. Displays a yellow warning banner: *"Funds were released on-chain, but the server could not be updated. Save this transaction hash."*
3. Shows the Stellar Expert link so the client and freelancer can verify the payment independently.

The backend can always be re-synced by re-calling `PATCH /api/jobs/:id/release` with the saved hash, since the route is idempotent for the same hash on a completed job (a future enhancement — currently it guards `status = 'in_escrow'` only).

---

## Code Reference

| File | Purpose |
|------|---------|
| `contracts/escrow-contract/src/lib.rs` | Soroban escrow contract — `create_job`, `release_escrow`, `get_job` |
| `backend/src/routes/jobs.js` | REST routes — `GET /api/jobs`, `GET /api/jobs/:id`, `PATCH /api/jobs/:id/release` |
| `backend/src/db/schema.sql` | `jobs` table DDL |
| `frontend/pages/jobs/index.tsx` | Job listing page |
| `frontend/pages/jobs/[id].tsx` | Job detail page — full release flow UI |
| `frontend/lib/stellar.ts` | `buildReleaseEscrowTransaction`, `submitTransaction`, `ESCROW_CONTRACT_ID` |
| `frontend/lib/api.ts` | `fetchJobs`, `fetchJob`, `completeJobRelease` |
| `frontend/lib/wallet.ts` | `signTransactionWithWallet` (Freighter integration) |
| `frontend/utils/types.ts` | `EscrowJob`, `EscrowJobStatus` TypeScript types |

---

## Related Documentation

- [Architecture Overview](./architecture.md) — System diagram and key design decisions
- [API Reference](./api.md) — Full REST API reference
- [Getting Started](./getting-started.md) — Local development setup
