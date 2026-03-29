"use strict";

const fs = require("fs");
const path = require("path");
const pool = require("./pool");
const { seedProjects, seedProjectUpdates, seedJobs } = require("../services/store");

async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const schemaPath = path.join(__dirname, "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf8");
    await client.query(schemaSql);

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
        ],
      );
    }

    for (const update of seedProjectUpdates) {
      await client.query(
        `INSERT INTO project_updates (id, project_id, title, body, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [update.id, update.projectId, update.title, update.body, update.createdAt],
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
        ],
      );
    }

    await client.query("COMMIT");
    console.log("[DB] Migration and seeding complete");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
