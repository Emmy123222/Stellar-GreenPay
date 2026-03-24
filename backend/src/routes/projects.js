/**
 * src/routes/projects.js
 */
"use strict";
const express  = require("express");
const router   = express.Router();
const { projects } = require("../services/store");

const VALID_STATUSES    = ["active","completed","paused"];
const VALID_CATEGORIES  = ["Reforestation","Solar Energy","Ocean Conservation","Clean Water","Wildlife Protection","Carbon Capture","Wind Energy","Sustainable Agriculture","Other"];

router.get("/", (req, res) => {
  const { category, status, verified, limit = 50 } = req.query;
  let result = Array.from(projects.values());
  if (status && VALID_STATUSES.includes(status))     result = result.filter(p => p.status === status);
  if (category && VALID_CATEGORIES.includes(category)) result = result.filter(p => p.category === category);
  if (verified === "true") result = result.filter(p => p.verified === true);
  result = result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.min(parseInt(limit) || 50, 100));
  res.json({ success: true, data: result });
});

router.get("/:id", (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found" });
  res.json({ success: true, data: p });
});

module.exports = router;
