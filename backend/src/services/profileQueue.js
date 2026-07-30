"use strict";

const PgBoss = require("pg-boss");
const pool = require("../db/pool");
const { computeBadges } = require("./store");

const QUEUE = "profile-update";
let boss = null;

async function start(io) {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("[profileQueue] pg-boss error:", err.message));

  await boss.start();

  await boss.work(QUEUE, { teamSize: 2, teamConcurrency: 1 }, async (job) => {
    const { donorAddress } = job.data;

    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(amount_xlm), 0)::numeric AS total
       FROM donations
       WHERE donor_address = $1
         AND amount_xlm IS NOT NULL`,
      [donorAddress],
    );

    const totalDonatedXlm = parseFloat(totalResult.rows[0]?.total || "0");

    const projectsSupportedResult = await pool.query(
      `SELECT COUNT(DISTINCT project_id) AS count
       FROM donations
       WHERE donor_address = $1`,
      [donorAddress],
    );

    const projectsSupported = Number.parseInt(projectsSupportedResult.rows[0]?.count || "0", 10);
    const badges = computeBadges(totalDonatedXlm);

    const existingProfileResult = await pool.query(
      "SELECT display_name, bio FROM profiles WHERE public_key = $1",
      [donorAddress],
    );

    const existingProfile = existingProfileResult.rows[0] || {};

    await pool.query(
      `INSERT INTO profiles (
         public_key,
         display_name,
         bio,
         total_donated_xlm,
         projects_supported,
         badges,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
       ON CONFLICT (public_key) DO UPDATE SET
         total_donated_xlm = EXCLUDED.total_donated_xlm,
         projects_supported = EXCLUDED.projects_supported,
         badges = EXCLUDED.badges,
         updated_at = EXCLUDED.updated_at`,
      [
        donorAddress,
        existingProfile.display_name || null,
        existingProfile.bio || null,
        totalDonatedXlm.toFixed(7),
        projectsSupported,
        JSON.stringify(badges),
      ],
    );

    if (io) {
      io.emit("profile_updated", {
        donorAddress,
        totalDonatedXLM: totalDonatedXlm.toFixed(7),
        projectsSupported,
        badges,
      });
    }
  });

  console.log("[profileQueue] pg-boss started, worker registered on queue:", QUEUE);
}

async function enqueueProfileUpdate(donorAddress) {
  if (!boss) {
    throw new Error("profileQueue not started — call start(io) first");
  }
  return boss.send(QUEUE, { donorAddress }, { retryLimit: 3, retryDelay: 10 });
}

module.exports = { start, enqueueProfileUpdate };
