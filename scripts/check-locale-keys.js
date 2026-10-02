#!/usr/bin/env node
/**
 * Checks that every locale file has the same top-level keys as en.json.
 * Exit code 1 if any locale is missing keys.
 */
const fs = require("fs");
const path = require("path");

const localesDir = path.join(__dirname, "..", "frontend", "locales");

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

const en = JSON.parse(fs.readFileSync(path.join(localesDir, "en.json"), "utf8"));
const enKeys = new Set(flattenKeys(en));

let failed = false;

for (const file of fs.readdirSync(localesDir)) {
  if (!file.endsWith(".json") || file === "en.json") continue;
  const locale = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"));
  const localeKeys = new Set(flattenKeys(locale));

  const missing = [...enKeys].filter((k) => !localeKeys.has(k));
  if (missing.length > 0) {
    console.error(`\n${file} is missing ${missing.length} key(s):`);
    for (const k of missing) console.error(`  - ${k}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nLocale key check failed.");
  process.exit(1);
} else {
  console.log("All locale files have matching keys.");
}