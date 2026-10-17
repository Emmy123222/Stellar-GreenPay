#!/usr/bin/env node
// Reads contracts/addresses.json and writes contract addresses into .env.local
// so Next.js picks them up without manual copy-paste after every redeployment.
// Runs automatically via the "prebuild" / "predev" npm hooks.

const fs = require('fs');
const path = require('path');

const addressesPath = process.env.CONTRACT_ADDRESSES_FILE ||
  path.resolve(__dirname, '../../contracts/addresses.json');
const envLocalPath = process.env.FRONTEND_ENV_FILE ||
  path.resolve(__dirname, '../.env.local');

if (!fs.existsSync(addressesPath)) {
  console.warn('[set-contract-env] contracts/addresses.json not found — skipping');
  process.exit(0);
}

let addresses;
try {
  addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
} catch (error) {
  console.error(`[set-contract-env] Could not read ${addressesPath}: ${error.message}`);
  process.exit(1);
}

const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || process.env.STELLAR_NETWORK || 'testnet';
const net = addresses[network] || {};

// Read existing .env.local so we only patch the two contract lines
let existing = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, 'utf8') : '';

function upsertLine(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return re.test(content) ? content.replace(re, line) : content + (content.endsWith('\n') ? '' : '\n') + line + '\n';
}

const contractIds = [
  ['NEXT_PUBLIC_CONTRACT_ID', net.contractId],
  ['NEXT_PUBLIC_ESCROW_CONTRACT_ID', net.escrowContractId],
];
let changed = false;

for (const [key, id] of contractIds) {
  if (typeof id === 'string' && id.trim()) {
    existing = upsertLine(existing, key, id.trim());
    changed = true;
  } else {
    console.warn(`[set-contract-env] ${key} is empty for "${network}" in contracts/addresses.json`);
  }
}

if (changed) {
  fs.writeFileSync(envLocalPath, existing);
  console.log(`[set-contract-env] Written configured contract addresses for "${network}" to ${envLocalPath}`);
}
