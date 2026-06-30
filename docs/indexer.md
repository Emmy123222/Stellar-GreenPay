# Horizon Indexer Service

The indexer is a background service that listens for native XLM payments on the Stellar network and records them as donations in the database. It is the bridge between on-chain activity and the application's leaderboard, profile badges, and donation feed.

---

## How It Works

### SSE Stream

The indexer uses the [Stellar SDK](https://github.com/stellar/js-stellar-sdk) `OperationsCallBuilder` to open a **Server-Sent Events (SSE)** connection to Horizon. The stream delivers real-time operations as they are included in ledgers.

```js
stellarServer.operations()
  .cursor("now")
  .stream({ onmessage, onerror });
```

- The `operations()` endpoint returns all operations on the network.
- Only operations with `type === "payment"` and `asset_type === "native"` (XLM) are processed.
- A filter matches the payment recipient (`op.to`) against an in-memory cache of active project wallets.

### Cursor Tracking

- The stream starts at `cursor("now")` — it does **not** replay historical ledgers.
- The last processed ledger sequence is held in a **module-level in-memory variable** (`lastProcessedLedger`).
- The cursor is **not persisted** to the database or any external store.
- On process restart, the indexer starts from `"now"` again, missing any operations that occurred during the downtime.

### Reconnect Logic

- The indexer **relies entirely on the Stellar SDK's built-in SSE reconnection**.
- There is no custom exponential backoff, health-check pings, or stream state monitoring beyond an `isRunning` flag that prevents duplicate `startIndexer` calls.
- On stream error, the `onerror` callback logs the error, but the SDK handles reconnection internally.

### Donation Processing Pipeline

When a matching payment arrives:

1. **Deduplication** — Checks if the `transaction_hash` already exists in the `donations` table.
2. **Insert donation** — Writes a new row with `project_id`, `donor_address`, `amount_xlm`, `transaction_hash`.
3. **Update project** — Increments `raised_xlm` and recalculates `donor_count`.
4. **Upsert donor profile** — Computes new `total_donated_xlm`, `projects_supported`, and badge tiers.
5. **Emit WebSocket event** — Notifies the frontend in real time via Socket.io.

All database writes are wrapped in a PostgreSQL transaction (`BEGIN` / `COMMIT` / `ROLLBACK`).

### Wallet Cache

- A `Map<wallet_address, project_id>` is built from the `projects` table at startup.
- The cache is refreshed every **10 minutes** via `setInterval`.
- Only projects with `status = 'active'` are included.

---

## Failure Modes

### SSE Disconnect

If the SSE connection drops, operations that occur during the disconnection may be silently lost. The SDK's internal reconnection resumes from wherever it last tracked the cursor, but if the SDK's cursor was not updated before the disconnect, those operations are skipped.

**Impact:** Missed donations with no automatic recovery.

### Duplicate Events

Horizon may deliver the same operation more than once under certain conditions (network hiccups, reconnection). The indexer handles this by checking for an existing `transaction_hash` in the database before inserting — duplicate events are silently skipped.

**Impact:** None — deduplication prevents double-counting.

### Horizon Rate Limiting

The Stellar testnet and public Horizon endpoints have rate limits. If the stream is throttled, operations may be delivered late or the connection may be reset. The SDK reconnects automatically, but any operations during the reset window may be missed.

**Impact:** Delayed or missed donation processing during high-throughput periods.

### Process Restart

The in-memory cursor is lost when the Node.js process exits. On restart, the stream begins from `"now"`, permanently missing any operations that occurred while the service was down.

**Impact:** Donations made during downtime are not recorded.

### Database Connection Failure

If the database is unreachable during `handleDonation`, the transaction rolls back and the error is logged. The operation is **not** retried or queued for later processing.

**Impact:** The donation is permanently lost.

### Exception in `onmessage`

An error in a single operation's processing is caught and logged, but the stream continues. If a `handleDonation` call fails mid-transaction, the database rolls back but the operation is not replayed.

**Impact:** That specific donation is silently dropped.

---

## Reconciliation

**There is currently no reconciliation mechanism.** The indexer has no backfill mode, no gap detection, and no periodic comparison against Horizon's latest ledger.

To recover from missed events, a reconciliation script could:

1. Query the database for the highest `ledger_attr` processed.
2. Iterate over Horizon operations from that ledger forward, filtering for payments to tracked wallets.
3. Process any unmatched transactions through the standard donation pipeline.

A future enhancement should add:

- A `indexer_state` table persisting the cursor between restarts.
- A periodic reconciliation job that detects and fills gaps.
- Prometheus-style metrics for stream health and processing lag.

---

## Health Check

The status is exposed via the `/health` endpoint:

```json
{
  "isRunning": true,
  "lastProcessedLedger": 12345678,
  "projectWalletsCount": 15,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon server endpoint |
| `DATABASE_URL` | — | PostgreSQL connection string |
| Wallet cache refresh | 10 minutes | Interval for refreshing project wallets |

---

## Code Reference

| File | Purpose |
|------|---------|
| `backend/src/services/indexerService.js` | Core indexer — SSE stream, payment processing, deduplication, DB writes, WebSocket emission |
| `backend/src/services/stellar.js` | Exports the `Horizon.Server` instance used by the indexer |
| `backend/src/server.js` | Calls `startIndexer(io)` during server boot |
| `backend/src/routes/health.js` | Exposes `getStatus()` in the `/health` response |
| `backend/src/services/store.js` | `computeBadges()` used to assign donor tiers |
| `backend/src/db/pool.js` | PostgreSQL connection pool |
