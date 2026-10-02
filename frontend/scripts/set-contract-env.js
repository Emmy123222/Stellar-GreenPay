#!/usr/bin/env node
// Reads contracts/addresses.json and writes contract addresses into .env.local
// so Next.js picks them up without manual copy-paste after every redeployment.
// Runs automatically via the "prebuild" / "predev" npm hooks.

const fs = require('fs');
const path = require('path');

const addressesPath = path.resolve(__dirname, '../../contracts/addresses.json');
const envLocalPath = path.resolve(__dirname, '../.env.local');

if (!fs.existsSync(addressesPath)) {
  console.warn('[set-contract-env] contracts/addresses.json not found — skipping');
  process.exit(0);
}

const addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet';
const net = addresses[network] || {};

if (!net.greenpay && !net.escrow) {
  console.warn(`[set-contract-env] No addresses set for "${network}" in contracts/addresses.json — skipping`);
  process.exit(0);
}

// Read existing .env.local so we only patch the two contract lines
let existing = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, 'utf8') : '';

function upsertLine(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return re.test(content) ? content.replace(re, line) : content + (content.endsWith('\n') ? '' : '\n') + line + '\n';
}

if (net.greenpay) existing = upsertLine(existing, 'NEXT_PUBLIC_CONTRACT_ID', net.greenpay);
if (net.escrow)   existing = upsertLine(existing, 'NEXT_PUBLIC_ESCROW_CONTRACT_ID', net.escrow);

fs.writeFileSync(envLocalPath, existing);
console.log(`[set-contract-env] Written contract addresses for "${network}" to .env.local`);
