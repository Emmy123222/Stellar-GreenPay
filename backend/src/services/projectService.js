/**
 * src/services/projectService.js
 */
"use strict";

const pool = require("../db/pool");
const { mapProjectRow } = require("./store");

const VALID_STATUSES = ["active", "completed", "paused"];
const VALID_CATEGORIES = [
  "Reforestation", "Solar Energy", "Ocean Conservation", "Clean Water",
  "Wildlife Protection", "Carbon Capture", "Wind Energy",
  "Sustainable Agriculture", "Other",
];

async function getAllProjects({ category, status, limit = 20 } = {}) {
  const where = [];
  const values = [];
  if (status && VALID_STATUSES.includes(status)) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  if (category && VALID_CATEGORIES.includes(category)) {
    values.push(category);
    where.push(`category = $${values.length}`);
  }
  const pageSize = Math.min(Number.parseInt(String(limit), 10) || 20, 100);
  values.push(pageSize);
  let query = "SELECT * FROM projects";
  if (where.length) query += " WHERE " + where.join(" AND ");
  query += ` ORDER BY created_at DESC LIMIT $${values.length}`;
  // eslint-disable-next-line sql-injection/no-sql-injection
  const result = await pool.query(query, values);
  return result.rows.map(mapProjectRow);
}

async function getProjectById(id) {
  const result = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);
  if (!result.rows[0]) return null;
  return mapProjectRow(result.rows[0]);
}

async function createProject({ id, name, description, category, location, walletAddress, goalXLM, co2PerXLM } = {}) {
  if (!name || !category || !walletAddress) {
    throw new Error("name, category, and walletAddress are required");
  }
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  const result = await pool.query(
    `INSERT INTO projects
       (id, name, description, category, location, wallet_address,
        goal_xlm, co2_offset_kg, status, verified, on_chain_verified,
        raised_xlm, donor_count, tags, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',false,false,0,0,'{}',NOW(),NOW())
     RETURNING *`,
    [id, name, description || "", category, location || "", walletAddress,
      goalXLM || "0", Number(co2PerXLM) || 0],
  );
  return mapProjectRow(result.rows[0]);
}

async function updateProject(id, updates = {}) {
  const { status, verified } = updates;
  const setClauses = [];
  const values = [];

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    values.push(status);
    setClauses.push(`status = $${values.length}`);
  }
  if (verified !== undefined) {
    values.push(Boolean(verified));
    setClauses.push(`verified = $${values.length}`);
  }
  if (!setClauses.length) {
    throw new Error("No valid fields to update");
  }

  setClauses.push("updated_at = NOW()");
  values.push(id);
  const result = await pool.query(
    // eslint-disable-next-line sql-injection/no-sql-injection
    `UPDATE projects SET ${setClauses.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (!result.rows[0]) return null;
  return mapProjectRow(result.rows[0]);
}

module.exports = { getAllProjects, getProjectById, createProject, updateProject };
