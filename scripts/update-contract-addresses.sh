#!/usr/bin/env bash
# Update contracts/addresses.json from soroban-cli after a redeployment.
#
# Usage:
#   ./scripts/update-contract-addresses.sh <network> <contract> <id>
#
# Examples:
#   ./scripts/update-contract-addresses.sh testnet greenpay CABC...
#   ./scripts/update-contract-addresses.sh testnet escrow   CXYZ...
#   ./scripts/update-contract-addresses.sh mainnet greenpay CABC...
#
# Or pipe the output of stellar contract deploy directly:
#   stellar contract deploy ... | xargs ./scripts/update-contract-addresses.sh testnet greenpay

set -euo pipefail

NETWORK=${1:-}
CONTRACT=${2:-}
ADDRESS=${3:-}

ADDRESSES_FILE="$(dirname "$0")/../contracts/addresses.json"

if [[ -z "$NETWORK" || -z "$CONTRACT" || -z "$ADDRESS" ]]; then
  echo "Usage: $0 <network> <contract> <address>"
  echo "  network:  testnet | mainnet"
  echo "  contract: greenpay | escrow"
  exit 1
fi

if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
  echo "Error: network must be 'testnet' or 'mainnet'"
  exit 1
fi

if [[ "$CONTRACT" != "greenpay" && "$CONTRACT" != "escrow" ]]; then
  echo "Error: contract must be 'greenpay' or 'escrow'"
  exit 1
fi

command -v node &>/dev/null || { echo "Error: node not found"; exit 1; }

node - "$NETWORK" "$CONTRACT" "$ADDRESS" "$ADDRESSES_FILE" <<'EOF'
const fs = require('fs');
const [,, network, contract, address, file] = process.argv;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data[network][contract] = address;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${network}.${contract} = ${address}`);
EOF
