#!/bin/bash
# scripts/setup-turrets.sh
# Setup script for Stellar Turrets donation matching service

set -e

echo "🚀 Setting up Stellar Turrets for donation matching..."

# Check if required environment variables are set
if [ -z "$MATCHER_SECRET_KEY" ]; then
  echo "⚠️  WARNING: MATCHER_SECRET_KEY not set"
  echo "   Set this in your .env file to enable automatic matching"
  echo "   Generate a testnet keypair at: https://laboratory.stellar.org/"
fi

# Enable Turrets in backend .env
BACKEND_ENV="backend/.env"
if [ -f "$BACKEND_ENV" ]; then
  if ! grep -q "ENABLE_TURRETS" "$BACKEND_ENV"; then
    echo "ENABLE_TURRETS=true" >> "$BACKEND_ENV"
    echo "TURRETS_PORT=3001" >> "$BACKEND_ENV"
    echo "✅ Added Turrets configuration to backend/.env"
  else
    echo "ℹ️  Turrets already configured in backend/.env"
  fi
else
  echo "⚠️  backend/.env not found. Creating..."
  cat > "$BACKEND_ENV" << EOF
ENABLE_TURRETS=true
TURRETS_PORT=3001
MATCHER_SECRET_KEY=
EOF
  echo "✅ Created backend/.env with Turrets configuration"
fi

echo ""
echo "📋 Next steps:"
echo "1. Set MATCHER_SECRET_KEY in backend/.env with your matcher account's secret key"
echo "2. Fund the matcher account with XLM on testnet/mainnet"
echo "3. Create matching offers in the database using the API"
echo "4. Restart the backend server to start the Turrets service"
echo ""
echo "✨ Turrets setup complete!"
