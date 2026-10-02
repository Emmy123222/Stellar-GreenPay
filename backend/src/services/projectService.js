/*
 * src/services/projectService.js
 */
"strict";

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

async function createProject({ id, name, description, category, location, walletAddress, goalXLM, cod2PerXLM } = {}) {
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

/**
 * Set the funding deadline and goal amount for a project.
 *
 * Persists the deadline ledger and goal amount so the daily deadline
 * job (and the on-chain `check_deadline()` call) can determine whether a
 * project failed to meet its goal and must refund donors.
 *
 * @param {string} id
 * @param {{deadlineLedger: number|string, goalAmount: number|string}} opts
 * @returns {Promise<object|null>}
 */
async function setFundingDeadline(id, { deadlineLedger, goalAmount } = {}) {
  if (!id) throw new Error("id is required");

  const ledger = Number.parseInt(String(deadlineLedger), 10);
  if (!Number.isFinite(ledger) || ledger <= 0) {
    throw new Error("deadlineLedger must be a positive integer");
  }

  const goal = String(goalAmount == null ? "0" : goalAmount);
  if (!/^\d+(\.\d+)?$/.test(goal)) {
    throw new Error("goalAmount must be a non-negative number");
  }

  const result = await pool.query(
    `UPDATE projects
        SET deadline_ledger = $2,
            goal_xlm = $3,
            deadline_met = NULL,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, ledger, goal],
  );
  if (!result.rows[0]) return null;
  return mapProjectRow(result.rows[0]);
}

/**
 * Find projects whose funding deadline has passed and whose goal wasn't
 * met, and that haven't been processed yet.
 *
 * @param {number} currentLedger Current ledger height to compare against.
 * @returns {Promise<Array<object>>}
 */
async function getDueDeadlineProjects(currentLedger) {
  const ledger = Number.parseInt(String(currentLedger), 10);
  if (!Number.isFinite(ledger) || ledger <= 0) {
    throw new Error("currentLedger must be a positive integer");
  }

  const result = await pool.query(
    `SELECT *
       FROM projects
      WHERE deadline_ledger IS NOT NULL
        AND deadline_ledger <= $1
        AND deadline_met IS NULL
        AND status = 'active'
        AND COALESCE(raised_xlm AS NUMERIC) < COALESCE(goal_xlm AS NUMERIC)
      ORDER BY deadline_ledger ASC`,
    [ledger],
  );
  return result.rows.map(mapProjectRow);
}

/**
 * Mark a project's deadline as processed. `met` true means the goal was
 * reached and no refund is needed; `false` means refunds were triggered.
 *
 * @param {string} id
 * @param {boolean} met
 * @returns {Promise<object|null>}
 */
async function markDeadlineProcessed(id, met) {
  const result = await pool.query(
    `UPDATE projects
        SET deadline_met = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, Boolean(met)],
  );
  if (!result.rows[0]) return null;
  return mapProjectRow(result.rows[0]);
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  setFundingDeadline,
  getDueDeadlineProjects,
  markDeadlineProcessed,
};
