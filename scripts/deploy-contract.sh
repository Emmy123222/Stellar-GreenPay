#!/usr/bin/env bash
# scripts/deploy-contract.sh
# Build and deploy the GreenPay Soroban contract.
#
# Usage:
#   chmod +x scripts/deploy-contract.sh
#   ./scripts/deploy-contract.sh [testnet|mainnet] [identity] [greenpay|escrow]
#
# Examples:
#   ./scripts/deploy-contract.sh testnet alice          # Deploy greenpay contract
#   ./scripts/deploy-contract.sh testnet alice escrow   # Deploy escrow contract

set -euo pipefail

NETWORK=${1:-testnet}
IDENTITY=${2:-alice}
CONTRACT_TYPE=${3:-greenpay}

# Derive the workspace target directory using cargo metadata
CONTRACTS_DIR="$(dirname "$0")/../contracts"
TARGET_DIR=$(cd "$CONTRACTS_DIR" && cargo metadata --format-version 1 | jq -r .target_directory)

# Set contract-specific paths
if [[ "$CONTRACT_TYPE" == "escrow" ]]; then
  CONTRACT_NAME="escrow_contract"
  CONTRACT_DIR="$CONTRACTS_DIR/escrow-contract"
else
  CONTRACT_NAME="greenpay_contract"
  CONTRACT_DIR="$CONTRACTS_DIR/greenpay-contract"
fi

WASM="$TARGET_DIR/wasm32v1-none/release/$CONTRACT_NAME.wasm"

echo "🌱 Stellar GreenPay — Contract Deploy"
echo "   Network:  $NETWORK"
echo "   Identity: $IDENTITY"
echo "   Contract: $CONTRACT_TYPE"
echo ""

command -v stellar &>/dev/null || { echo "❌ stellar CLI not found. Run: cargo install --locked stellar-cli"; exit 1; }
command -v cargo   &>/dev/null || { echo "❌ Cargo not found. Install: https://rustup.rs"; exit 1; }
command -v jq      &>/dev/null || { echo "❌ jq not found. Install: https://stedolan.github.io/jq"; exit 1; }

echo "🔨 Building WASM..."
cd "$CONTRACTS_DIR"
cargo build --target wasm32v1-none --release -p "$CONTRACT_TYPE-contract"
echo "   ✅ Built: $(du -sh "$WASM" | cut -f1)"

echo ""
echo "🚀 Deploying to $NETWORK..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK" 2>&1)

echo "✅ Deployed! Contract ID: $CONTRACT_ID"

ADMIN_KEY=$(stellar keys address "$IDENTITY" 2>/dev/null || echo "")

# Initialize contract (greenpay only - escrow has different initialization)
if [[ "$CONTRACT_TYPE" == "greenpay" ]] && [[ -n "$ADMIN_KEY" ]]; then
  echo ""
  echo "🔧 Initializing contract..."
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- initialize \
    --admin "$ADMIN_KEY"
  echo "   ✅ Initialized with admin: $ADMIN_KEY"
fi

echo ""
echo "──────────────────────────────────────────"
echo "  Add to your .env files:"
echo "  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID"
echo "  CONTRACT_ID=$CONTRACT_ID"
echo "──────────────────────────────────────────"

if [[ "$CONTRACT_TYPE" == "greenpay" ]]; then
  echo ""
  echo "  Next: Register your first climate project:"
  echo "  stellar contract invoke --id $CONTRACT_ID \\"
  echo "    --source $IDENTITY --network $NETWORK \\"
  echo "    -- register_project \\"
  echo "    --admin $ADMIN_KEY \\"
  echo "    --project_id 'project-001' \\"
  echo "    --name 'Amazon Reforestation' \\"
  echo "    --wallet <PROJECT_WALLET_ADDRESS> \\"
  echo "    --co2_per_xlm 8500"
  echo "──────────────────────────────────────────"
fi
