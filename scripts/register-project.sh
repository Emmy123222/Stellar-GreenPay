#!/bin/bash
# scripts/register-project.sh
# Usage: ./scripts/register-project.sh <project_id> <name> <wallet> <co2_per_xlm>

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
  echo "Usage: ./register-project.sh <project_id> <name> <wallet> <co2_per_xlm>"
  exit 1
fi

# Load variables from backend .env
if [ -f "backend/.env" ]; then
  export $(grep CONTRACT_ID backend/.env | xargs)
fi

if [ -z "$CONTRACT_ID" ]; then
  echo "Error: CONTRACT_ID not found in backend/.env"
  exit 1
fi

echo "🌱 Registering project '$2' ($1) on-chain..."

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source alice \
  --network testnet \
  -- \
  register_project \
  --project_id "$1" \
  --name "$2" \
  --wallet "$3" \
  --co2_per_xlm "$4"

if [ $? -eq 0 ]; then
  echo "✅ Project registered successfully!"
else
  echo "❌ Registration failed."
  exit 1
fi
