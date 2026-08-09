"use strict";

/**
 * Shared constants used across route files.
 */

const VALID_STATUSES = ["active", "completed", "paused"];

const VALID_CATEGORIES = [
  "Reforestation",
  "Solar Energy",
  "Ocean Conservation",
  "Clean Water",
  "Wildlife Protection",
  "Carbon Capture",
  "Wind Energy",
  "Sustainable Agriculture",
  "Other",
];

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z0-9]{55}$/;

module.exports = { VALID_STATUSES, VALID_CATEGORIES, STELLAR_PUBLIC_KEY_RE };
