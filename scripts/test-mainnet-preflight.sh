#!/usr/bin/env bash

# Test script for mainnet-preflight.sh
# Demonstrates both passing and failing scenarios

echo "========================================"
echo "TEST 1: Missing Environment Variables"
echo "========================================"
bash scripts/mainnet-preflight.sh
echo ""

echo "========================================"
echo "TEST 2: Wrong Network (testnet)"
echo "========================================"
export STELLAR_NETWORK="testnet"
export STELLAR_RPC_URL="https://soroban-testnet.stellar.org"
export CONTRACT_ID="CTEST123"
export DATABASE_URL="postgresql://user:pass@localhost:5432/greenpay"
export REDIS_URL="redis://localhost:6379"
export WEBHOOK_URL="https://example.com/webhook"
bash scripts/mainnet-preflight.sh
echo ""

echo "========================================"
echo "TEST 3: Insecure HTTP Webhook"
echo "========================================"
export STELLAR_NETWORK="mainnet"
export WEBHOOK_URL="http://example.com/webhook"
bash scripts/mainnet-preflight.sh
echo ""

echo "========================================"
echo "TEST 4: Valid Mainnet Configuration"
echo "========================================"
export STELLAR_NETWORK="mainnet"
export STELLAR_RPC_URL="https://soroban-mainnet.stellar.org"
export CONTRACT_ID="CCvalid123456789"
export DATABASE_URL="postgresql://user:pass@prod-db.example.com:5432/greenpay"
export REDIS_URL="redis://prod-redis.example.com:6379"
export WEBHOOK_URL="https://api.example.com/webhooks/stellar"
bash scripts/mainnet-preflight.sh
echo ""
