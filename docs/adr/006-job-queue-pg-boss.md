# ADR 006: Job Queue — pg-boss on PostgreSQL

## Status

Accepted

## Context and Problem Statement

Stellar GreenPay needs a background job queue for asynchronous work: syncing on-chain donation events, sending notification emails and push notifications, processing recurring donation pledges, refreshing the global stats materialized view, and running scheduled/cron-style tasks (e.g. periodic leaderboard recalculation, webhook retries, token cleanup).

The queue is a significant architectural decision because every async workflow depends on it, and replacing it later would touch most backend services. The main candidates were:

- **pg-boss** — a job queue built directly on PostgreSQL.
- **BullMQ** — the most common Node.js job queue, backed by Redis.
- **Celery** — the Python ecosystem standard (would require a separate Python worker service).
- **A simple cron** — `node-cron` / OS cron triggering in-process or scripted jobs.

## Decision Drivers

- The project already runs PostgreSQL as its primary datastore; minimizing additional infrastructure matters for a small open-source, volunteer-run project.
- Job creation must be able to participate in the same database transaction as the business data it depends on (e.g. inserting a donation record and enqueueing its notification job atomically).
- Recurring/scheduled jobs must be supported without wiring a separate scheduler.
- Operational surface (deployment topology, monitoring, backups) should stay as small as possible.
- Throughput needs are moderate: donation events, emails, and periodic refreshes — not millions of jobs per minute.

## Considered Options

- pg-boss (PostgreSQL-backed queue)
- BullMQ (Redis-backed queue)
- Celery (Python worker + broker)
- Simple cron (node-cron / OS cron)

## Decision Outcome

Chosen option: **pg-boss** — a job queue that lives inside the same PostgreSQL database the application already uses.

### Why pg-boss

- **No separate broker**: pg-boss stores jobs, schedules, and archive/history in its own schema (`pgboss`) inside the existing database. There is no Redis (or other broker) to deploy, secure, monitor, or pay for — a meaningful simplification for a small team and for self-hosted deployments.
- **Transactional job creation**: because jobs are rows in Postgres, enqueueing can happen inside the same transaction as the business write. A donation record and its notification job commit atomically; a rollback removes both. Redis-backed queues cannot participate in a Postgres transaction, leaving a window where a job can be lost or duplicated relative to the DB write.
- **Built-in cron scheduling**: pg-boss ships `schedule()`/cron-style recurring jobs out of the box, covering periodic tasks (stats refresh, recurring-donation processing, token cleanup, webhook retries) without a separate `node-cron` process.
- **Recovery for free**: database backups implicitly include job state, so jobs survive restores and in-flight work is recoverable.

### Trade-offs vs. alternatives

- **Throughput**: Redis is in-memory, so BullMQ generally offers lower latency and higher throughput for very high-volume queues. pg-boss is disk-backed via Postgres and is slower under heavy load. This is acceptable for the expected job volume (donation events, emails, periodic refreshes) but is a real ceiling if volume grows dramatically.
- **Ecosystem/tooling**: BullMQ has a larger ecosystem, including the Bull Board dashboard UI for inspecting queues. pg-boss tooling is comparatively minimal; queue inspection is mostly SQL queries against its own tables.
- **Shared database load**: pg-boss adds load to Postgres itself as job concurrency increases, so Postgres capacity becomes a shared bottleneck between application queries and job processing. Redis-backed queues offload that to a separate, independently scalable broker.
- **Operational maturity**: BullMQ is the more established pattern for scaling many distributed workers; pg-boss works well at this project's scale but is less common, so operational knowledge is harder to find.
- **Celery** was rejected: it would require introducing a Python worker service into a Node.js backend, splitting the codebase and deployment for no benefit.
- **Simple cron** was rejected: in-process cron does not survive restarts cleanly, cannot retry failed jobs with backoff, has no visibility into job state, and does not compose with transactional enqueueing.

## Positive Consequences

- One less service to deploy, secure, and monitor (no Redis container or managed instance).
- Job creation is transactional with business data — no lost or duplicated jobs on rollback.
- Scheduled/cron jobs are built in; no separate scheduler process.
- Database backups include job state, so the queue recovers with the rest of the data.
- The deployment topology stays simple: Node.js API + PostgreSQL.

## Negative Consequences

- Job throughput is bounded by Postgres capacity; very high-volume workloads would need a different queue.
- Queue inspection and tooling are weaker than Redis-backed alternatives (mostly SQL against `pgboss` tables).
- Postgres load is shared between application traffic and job processing, so capacity planning must account for both.
- If job volume grows to the point where Postgres becomes a bottleneck, this decision should be revisited (see Trade-offs).

## More Information

- [Queue monitoring guide](../queue-monitoring.md)
- [Architecture overview](../architecture.md)
- [pg-boss documentation](https://github.com/timgit/pg-boss)
- Supersedes the earlier informal note in [ADR 002](./002-pgboss-queue.md); this is the canonical record of the decision.
