# ADR 002: Use pg-boss for Background Job Queue

## Status
Accepted

## Context
Stellar GreenPay needs a background job queue for tasks such as syncing on-chain donation events, sending notification emails, and running scheduled/cron jobs (e.g. periodic leaderboard recalculation). The two main candidates evaluated were:

- **pg-boss** — a job queue built directly on PostgreSQL.
- **Bull / BullMQ** — Redis-backed job queues, the most common Node.js choice.

## Decision
We chose **pg-boss** over Bull/BullMQ.

### Why pg-boss
- **No extra infrastructure dependency**: the project already runs PostgreSQL as its primary datastore. pg-boss uses that same database, so we avoid standing up, securing, and monitoring a separate Redis instance (extra cost and operational surface, especially relevant for a small open-source/volunteer-run project).
- **Transactional guarantees**: because jobs are stored in Postgres, job creation can happen in the same transaction as the business data it depends on (e.g. inserting a donation record and enqueueing a notification job atomically). Bull/BullMQ, being Redis-backed, cannot participate in a Postgres transaction, so there's a window where a job could be lost or duplicated relative to the DB write.
- **Built-in cron scheduling**: pg-boss ships with `schedule()`/cron-style recurring jobs out of the box, which covers our periodic tasks (leaderboard refresh, retrying failed on-chain syncs) without a separate scheduler like `node-cron` wired to Bull.

### Trade-offs vs Bull/BullMQ
- **Throughput**: Redis is an in-memory store, so Bull/BullMQ generally has lower latency and higher throughput for very high-volume queues. pg-boss, being disk-backed via Postgres, is slower under heavy load — acceptable for our expected job volume (donation events, emails), but a real ceiling if job volume grows dramatically.
- **Ecosystem/tooling**: Bull/BullMQ has a larger ecosystem, including the Bull Board / BullMQ dashboard UI for inspecting queues. pg-boss's tooling is comparatively minimal; queue inspection is mostly via SQL queries against its own tables.
- **Horizontal scaling patterns**: Redis-backed queues are a more established pattern for scaling many distributed workers. pg-boss works well but adds load to Postgres itself as concurrency increases, so Postgres capacity becomes a shared bottleneck between application queries and job processing.

## Operational Implications
- pg-boss creates and manages its own schema (`pgboss` by default) inside the same PostgreSQL database, including tables for jobs, schedules, and archive/history. This needs to be accounted for in migrations, backups, and connection-pool sizing.
- Database backups now implicitly include job state; this is a benefit (jobs recoverable on restore) but also means the job queue's storage footprint grows with the main database rather than a separate, independently-scalable Redis instance.
- No additional service to deploy or monitor (no Redis container/managed instance), simplifying the deployment topology for the current scale of the project.
- If job volume grows to the point Postgres becomes a bottleneck, this decision should be revisited — see "Trade-offs" above.

## Alternatives Considered
- **Bull/BullMQ (Redis-backed)** — rejected for now due to added infra dependency and lack of transactional guarantees with Postgres; may be reconsidered if throughput needs increase significantly.
