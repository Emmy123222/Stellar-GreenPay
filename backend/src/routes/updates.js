/**
 * src/routes/updates.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool = require("../db/pool");
const { mapProjectUpdateRow } = require("../services/store");

router.get("/:projectId", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM project_updates
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [req.params.projectId],
    );
    res.json({ success: true, data: result.rows.map(mapProjectUpdateRow) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
