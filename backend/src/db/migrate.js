"use strict";

const fs = require("fs");
const path = require("path");
const pool = require("./pool");
const { seedProjects, seedProjectUpdates, seedJobs } = require("../services/store");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name    TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function loadMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => ({
      version: f.replace(".js", ""),
      file: path.join(MIGRATIONS_DIR, f),
    }));
}

async function getAppliedVersions(client) {
  const result = await client.query(
    "SELECT version FROM schema_migrations ORDER BY version ASC"
  );
  return result.rows.map((r) => r.version);
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureMigrationsTable(client);

    const applied = await getAppliedVersions(client);
    const files = loadMigrationFiles();
    let ran = 0;

    for (const { version, file } of files) {
      if (applied.includes(version)) continue;
      const migration = require(file);
      console.log(`[DB] Applying migration: ${version}`);
      await migration.up(client);
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [version, migration.name ?? version]
      );
      ran++;
    }

    if (ran === 0) {
      console.log("[DB] No pending migrations");
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await seedDatabase();
  console.log("[DB] Migration complete");
}

/**
 * Roll back the last `steps` applied migrations (default: 1).
 * Each migration's `down()` function is called in reverse-applied order.
 */
async function rollbackMigrations(steps = 1) {
  if (steps < 1) throw new Error("steps must be >= 1");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureMigrationsTable(client);

    const result = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT $1",
      [steps]
    );

    if (result.rows.length === 0) {
      console.log("[DB] Nothing to roll back");
      await client.query("COMMIT");
      return;
    }

    for (const row of result.rows) {
      const file = path.join(MIGRATIONS_DIR, `${row.version}.js`);
      if (!fs.existsSync(file)) {
        throw new Error(`Migration file not found for rollback: ${file}`);
      }
      const migration = require(file);
      if (typeof migration.down !== "function") {
        throw new Error(`Migration ${row.version} does not export a down() function`);
      }
      console.log(`[DB] Rolling back migration: ${row.version}`);
      await migration.down(client);
      await client.query(
        "DELETE FROM schema_migrations WHERE version = $1",
        [row.version]
      );
    }

    await client.query("COMMIT");
    console.log(`[DB] Rolled back ${result.rows.length} migration(s)`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function seedDatabase() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const project of seedProjects) {
      await client.query(
        `INSERT INTO projects (
          id, name, description, category, location, wallet_address, goal_xlm,
          raised_xlm, donor_count, co2_offset_kg, status, verified, on_chain_verified,
          tags, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          project.id,
          project.name,
          project.description,
          project.category,
          project.location,
          project.walletAddress,
          project.goalXLM,
          project.raisedXLM,
          project.donorCount,
          project.co2OffsetKg,
          project.status,
          project.verified,
          project.onChainVerified,
          project.tags,
          project.createdAt,
          project.updatedAt,
        ]
      );
    }

    for (const update of seedProjectUpdates) {
      await client.query(
        `INSERT INTO project_updates (id, project_id, title, body, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [update.id, update.projectId, update.title, update.body, update.createdAt]
      );
    }

    for (const job of seedJobs) {
      await client.query(
        `INSERT INTO jobs (
          id, title, description, client_public_key, freelancer_public_key,
          amount_escrow_xlm, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING`,
        [
          job.id,
          job.title,
          job.description,
          job.clientPublicKey,
          job.freelancerPublicKey,
          job.amountEscrowXlm,
          job.status,
          job.createdAt,
          job.updatedAt,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- CLI entry point ---
// node migrate.js [--rollback [N]]

if (require.main === module) {
  const args = process.argv.slice(2);
  const rollbackIdx = args.indexOf("--rollback");

  if (rollbackIdx !== -1) {
    const stepsArg = args[rollbackIdx + 1];
    const steps = stepsArg && !stepsArg.startsWith("--") ? parseInt(stepsArg, 10) : 1;
    rollbackMigrations(steps)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("[DB] Rollback failed:", err.message);
        process.exit(1);
      });
  } else {
    runMigrations()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("[DB] Migration failed:", err.message);
        process.exit(1);
      });
  }
}

module.exports = { runMigrations, rollbackMigrations };
