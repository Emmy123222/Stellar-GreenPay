# Stellar GreenPay - Mainnet Deployment Guide

## 🚀 Quick Start

Before deploying to mainnet, run the preflight check:

```bash
bash scripts/mainnet-preflight.sh
```

If all checks pass (exit code 0), you're ready to deploy. If any fail (exit code 1), resolve issues before proceeding.

---

## 📋 Pre-Deployment Checklist

### 1. Environment Configuration
- [ ] Copy `.env.mainnet.example` to `.env.mainnet`
- [ ] Update all placeholder values with production credentials
- [ ] Verify `STELLAR_NETWORK=mainnet`
- [ ] Confirm `WEBHOOK_URL` uses HTTPS
- [ ] Rotate all secrets from testnet/development

### 2. Smart Contract
- [ ] Contract deployed to Stellar mainnet
- [ ] Contract ID documented in `.env.mainnet`
- [ ] Contract initialization verified
- [ ] Contract admin keys secured

### 3. Infrastructure
- [ ] Production database provisioned
- [ ] Database migrations applied
- [ ] Redis instance configured
- [ ] Network connectivity verified
- [ ] Firewall rules configured

### 4. Security
- [ ] SSL/TLS certificates valid
- [ ] Secrets stored securely (Vault, AWS Secrets Manager, etc.)
- [ ] CORS origins configured correctly
- [ ] Rate limiting enabled
- [ ] Security headers configured

### 5. Monitoring
- [ ] Sentry or error tracking configured
- [ ] Logging pipeline active
- [ ] Metrics collection enabled
- [ ] Alerts configured
- [ ] Backup strategy tested

---

## 🔍 Preflight Check Details

The `mainnet-preflight.sh` script performs six critical validation checks:

### ✅ Check 1: Required Environment Variables
Validates that all critical variables are set:
- `STELLAR_NETWORK`
- `STELLAR_RPC_URL`
- `CONTRACT_ID`
- `DATABASE_URL`
- `REDIS_URL`
- `WEBHOOK_URL`

**Exit on failure:** Yes

### ✅ Check 2: Network Enforcement
Ensures `STELLAR_NETWORK` is set to `mainnet`.

**Exit on failure:** Yes (prevents testnet/futurenet deployments)

### ✅ Check 3: Contract Verification
Verifies the contract exists and is initialized on mainnet using:
1. Stellar CLI (`stellar contract read`) if available
2. JSON-RPC fallback (`getLedgerEntries`) otherwise

**Exit on failure:** Yes

### ✅ Check 4: Webhook URL Validation
Validates webhook URL format and security:
- Must use HTTPS protocol
- Must match pattern: `^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$`
- Blocks insecure HTTP webhooks

**Exit on failure:** Yes

### ✅ Check 5: Database Health
Tests database connectivity and migration status:
1. Connection test using `psql` or TCP socket
2. Migration file detection
3. Migration status verification (if tooling available)

**Exit on failure:** Yes (if connection fails)
**Warning on:** Missing migration tools

### ✅ Check 6: Redis Connectivity
Validates Redis availability:
1. PING test using `redis-cli` if available
2. TCP connection test as fallback

**Exit on failure:** Yes (if connection fails)
**Warning on:** Missing redis-cli

---

## 🛠️ Installation & Setup

### 1. Make Script Executable

```bash
chmod +x scripts/mainnet-preflight.sh
```

### 2. Install Optional Dependencies (Recommended)

```bash
# Stellar CLI (for contract verification)
cargo install --locked stellar-cli --features opt

# PostgreSQL client (for database checks)
apt-get install postgresql-client  # Ubuntu/Debian
brew install postgresql             # macOS

# Redis CLI (for Redis PING test)
apt-get install redis-tools         # Ubuntu/Debian
brew install redis                  # macOS
```

### 3. Configure Environment

```bash
# Copy example configuration
cp .env.mainnet.example .env.mainnet

# Edit with production values
nano .env.mainnet

# Verify configuration
bash scripts/mainnet-preflight.sh
```

---

## 🚦 Deployment Workflow

### Standard Deployment

```bash
#!/bin/bash
set -e

# 1. Run preflight checks
echo "Running preflight checks..."
bash scripts/mainnet-preflight.sh

# 2. Build application
echo "Building application..."
docker-compose -f docker-compose.mainnet.yml build

# 3. Deploy
echo "Deploying to mainnet..."
docker-compose -f docker-compose.mainnet.yml up -d

# 4. Health check
echo "Verifying deployment..."
curl -f https://api.greenpay.example.com/health

echo "✓ Deployment complete!"
```

### CI/CD Integration (GitHub Actions)

```yaml
name: Deploy to Mainnet

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure Environment
        run: |
          echo "STELLAR_NETWORK=mainnet" >> .env.mainnet
          echo "STELLAR_RPC_URL=${{ secrets.STELLAR_RPC_URL }}" >> .env.mainnet
          echo "CONTRACT_ID=${{ secrets.CONTRACT_ID }}" >> .env.mainnet
          echo "DATABASE_URL=${{ secrets.DATABASE_URL }}" >> .env.mainnet
          echo "REDIS_URL=${{ secrets.REDIS_URL }}" >> .env.mainnet
          echo "WEBHOOK_URL=${{ secrets.WEBHOOK_URL }}" >> .env.mainnet
      
      - name: Run Preflight Checks
        run: bash scripts/mainnet-preflight.sh
      
      - name: Deploy Application
        if: success()
        run: |
          # Your deployment commands here
          echo "Deploying to mainnet..."
```

### Docker Integration

Add preflight to your `Dockerfile` or `docker-compose.yml`:

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy application
COPY . .

# Install dependencies
RUN npm ci --only=production

# Add preflight check to startup
CMD ["sh", "-c", "bash scripts/mainnet-preflight.sh && npm start"]
```

Or in `docker-compose.yml`:

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    command: >
      sh -c "
        bash /app/scripts/mainnet-preflight.sh &&
        npm start
      "
    environment:
      - STELLAR_NETWORK=mainnet
      - STELLAR_RPC_URL=${STELLAR_RPC_URL}
      - CONTRACT_ID=${CONTRACT_ID}
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - WEBHOOK_URL=${WEBHOOK_URL}
```

---

## 🐛 Troubleshooting

### Issue: Contract Verification Fails

**Symptoms:**
```
[FAIL] Contract does not appear to be deployed or initialized on mainnet
```

**Solutions:**
1. Verify contract ID is correct: `echo $CONTRACT_ID`
2. Check contract on Stellar Expert: `https://stellar.expert/explorer/public/contract/$CONTRACT_ID`
3. Manually test RPC: `curl -X POST $STELLAR_RPC_URL -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
4. Ensure Stellar CLI is installed: `stellar --version`

### Issue: Database Connection Fails

**Symptoms:**
```
[FAIL] Cannot connect to database
```

**Solutions:**
1. Test connection manually: `psql $DATABASE_URL -c "SELECT 1;"`
2. Verify network connectivity: `nc -zv db-host 5432`
3. Check credentials and hostname in `DATABASE_URL`
4. Review firewall rules and security groups
5. Ensure database is running: `docker ps | grep postgres`

### Issue: Redis Connection Fails

**Symptoms:**
```
[FAIL] Redis did not respond to PING command
```

**Solutions:**
1. Test Redis manually: `redis-cli -u $REDIS_URL PING`
2. Verify Redis is running: `docker ps | grep redis`
3. Check authentication: `redis-cli -u $REDIS_URL --no-auth-warning PING`
4. Review network connectivity: `nc -zv redis-host 6379`

### Issue: Webhook Validation Fails

**Symptoms:**
```
[FAIL] WEBHOOK_URL uses insecure HTTP protocol
```

**Solutions:**
1. Update webhook URL to use HTTPS: `export WEBHOOK_URL=https://...`
2. Verify SSL certificate is valid: `curl -I $WEBHOOK_URL`
3. Check webhook endpoint is reachable: `curl -X POST $WEBHOOK_URL`

---

## 📊 Success Criteria

A successful preflight check will show:

```
╔═══════════════════════════════════════════════════════════╗
║  ✓ ALL PREFLIGHT CHECKS PASSED                           ║
║  System is ready for mainnet deployment                  ║
╚═══════════════════════════════════════════════════════════╝

✓ Passed: 12+
⚠ Warnings: 0-2 (acceptable if optional tools missing)
✗ Failed: 0
```

**Exit Code:** `0` (safe to deploy)

---

## ⚠️ Critical Warnings

### DO NOT Deploy If:
- ❌ Preflight check fails (exit code 1)
- ❌ `STELLAR_NETWORK` is not set to `mainnet`
- ❌ Contract is not verified on mainnet
- ❌ Database migrations are pending
- ❌ Webhook URL uses HTTP instead of HTTPS
- ❌ Any required environment variable is missing

### Acceptable Warnings:
- ⚠️ Optional tools not installed (stellar CLI, redis-cli, psql)
- ⚠️ Migration verification skipped (if migration script not available)

---

## 🔒 Security Best Practices

1. **Never commit secrets to version control**
   - Use `.env.mainnet` (add to `.gitignore`)
   - Use secrets management tools (Vault, AWS Secrets Manager)

2. **Rotate all credentials**
   - Generate new secrets for mainnet
   - Never reuse testnet credentials

3. **Use HTTPS everywhere**
   - Webhook URLs must use HTTPS
   - API endpoints must use HTTPS
   - Frontend must use HTTPS

4. **Implement monitoring**
   - Set up error tracking (Sentry)
   - Configure uptime monitoring
   - Enable audit logging

5. **Test disaster recovery**
   - Verify backup restoration
   - Document rollback procedures
   - Test failover scenarios

---

## 📚 Additional Resources

- **Stellar Documentation:** https://developers.stellar.org
- **Soroban Smart Contracts:** https://soroban.stellar.org
- **Preflight Script README:** [scripts/PREFLIGHT-README.md](scripts/PREFLIGHT-README.md)
- **Environment Example:** [.env.mainnet.example](.env.mainnet.example)

---

## 🆘 Support

For deployment issues:
1. Review preflight check output
2. Check [scripts/PREFLIGHT-README.md](scripts/PREFLIGHT-README.md)
3. Consult troubleshooting section above
4. Review Stellar GreenPay documentation
5. Contact DevOps team

---

## 📝 Deployment History

Keep a log of deployments:

```bash
# Example deployment log entry
echo "$(date -u +"%Y-%m-%d %H:%M:%S UTC") - Deployed version v1.2.3 to mainnet" >> deployment.log
```

---

**Last Updated:** 2026-07-30  
**Script Version:** 1.0.0  
**Maintainer:** DevOps Team
