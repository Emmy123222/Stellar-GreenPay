#!/usr/bin/env bash
set +e
cd /Users/caner/.local/drips-agent/workspace/Stellar-GreenPay
{
  echo "=== node --check server.js ==="
  node --check backend/src/server.js

  echo "=== backend tests ==="
  cd backend
  if [ ! -d node_modules ]; then npm ci; fi
  npm test -- --testPathPattern='csrf.test.js|subscriptions.test.js' --coverage=false
  echo "backend_exit:$?"

  echo "=== gitleaks URL check ==="
  curl -fsI "https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/gitleaks_8.24.3_linux_x64.tar.gz" | head -5

  echo "=== helm lint ==="
  which helm && helm lint helm/greenpay/ || echo "helm missing"

  echo "=== frontend type-check (if node_modules) ==="
  cd ../frontend
  if [ -d node_modules ]; then npm run type-check; echo "frontend_tc_exit:$?"; else echo "no frontend node_modules"; fi

  echo "=== contracts ==="
  cd ../contracts
  which cargo && cargo check --workspace 2>&1 | tail -40 || echo "cargo missing"

  rm -f backend/src/server.js.broken.bak
  echo DONE
} 2>&1 | tee /Users/caner/.local/drips-agent/workspace/Stellar-GreenPay/.ci-local-results.txt
