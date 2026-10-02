"use strict";

/**
 * src/db/migrationLock.js
 *
 * Cross-process migration lock.
 *
 * Database migrations must never run concurrently: two processes racing through
 * the pending-migration list could apply the same migration twice, apply them
 * out of order, or corrupt the `schema_migrations` bookkeeping. A single
 * accidentally parallel run (e.g. a rolling deploy where several backend
 * replicas boot at once, or a CI job overlapping a deploy) is enough to break
 * production, so every entry point (`npm run migrate`, `npm run db:rollback`
 * and the server boot path) goes through this lock.
 *
 * The lock is a Postgres session-level advisory lock, which has two useful
 * properties:
 *   - it is keyed on a stable integer, not the database/table, so it works
 *     before the `schema_migrations` table exists;
 *   - it is owned by the connection, so it is released automatically if the
 *     process crashes or is killed — no stale lockfiles to clean up.
 */

const pool = require("./pool");

// Stable 32-bit key ("gree" in hex). Never change this value without also
// thinking about in-flight deploys holding the old key.
const MIGRATION_LOCK_KEY = 0x67726565; // 1735689573

const DEFAULT_TIMEOUT_SECONDS = Number.parseInt(
  process.env.MIGRATION_LOCK_TIMEOUT_SECONDS || "60",
  10
);
const RETRY_INTERVAL_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to acquire the migration lock, waiting up to `timeoutSeconds` for any
 * competing migration run to finish.
 *
 * @param {{ timeoutSeconds?: number, onWait?: (waitedMs: number) => void }} [options]
 * @returns {Promise<import("pg").PoolClient>} the client that holds the lock
 * @throws if the lock could not be acquired before the timeout
 */
async function acquireMigrationLock(options = {}) {
  const {
    timeoutSeconds = Number.isNaN(DEFAULT_TIMEOUT_SECONDS)
      ? 60
      : DEFAULT_TIMEOUT_SECONDS,
    onWait,
  } = options;

  const client = await pool.connect();
  const deadline = Date.now() + Math.max(0, timeoutSeconds) * 1000;

  try {
    for (;;) {
      const { rows } = await client.query(
        "SELECT pg_try_advisory_lock($1::bigint) AS locked",
        [MIGRATION_LOCK_KEY]
      );

      if (rows[0].locked) {
        return client;
      }

      if (timeoutSeconds <= 0 || Date.now() >= deadline) {
        throw new Error(
          "Could not acquire migration lock: another migration run is in progress. " +
            "Wait for it to finish, or raise MIGRATION_LOCK_TIMEOUT_SECONDS."
        );
      }

      if (onWait) onWait(Date.now() - (deadline - timeoutSeconds * 1000));
      await sleep(RETRY_INTERVAL_MS);
    }
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Release the migration lock and return the connection to the pool.
 * Safe to call even if the lock was already released.
 *
 * @param {import("pg").PoolClient} client
 */
async function releaseMigrationLock(client) {
  if (!client) return;
  try {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [
      MIGRATION_LOCK_KEY,
    ]);
  } finally {
    client.release();
  }
}

/**
 * Run `fn` while holding the migration lock.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ timeoutSeconds?: number, onWait?: (waitedMs: number) => void }} [options]
 * @returns {Promise<T>}
 */
async function withMigrationLock(fn, options) {
  const client = await acquireMigrationLock(options);
  try {
    return await fn();
  } finally {
    await releaseMigrationLock(client);
  }
}

module.exports = {
  MIGRATION_LOCK_KEY,
  DEFAULT_TIMEOUT_SECONDS,
  acquireMigrationLock,
  releaseMigrationLock,
  withMigrationLock,
};
