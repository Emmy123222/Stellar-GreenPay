# Mainnet Preflight Check Script

## Overview

`mainnet-preflight.sh` is a comprehensive pre-deployment validation script that ensures all critical prerequisites are met before launching Stellar GreenPay on mainnet.

## Purpose

This script prevents production failures by validating:
- ✅ Environment configuration
- ✅ Stellar network settings
- ✅ Smart contract deployment
- ✅ Database connectivity and migrations
- ✅ Redis availability
- ✅ Webhook security compliance

## Usage

### Basic Usage

```bash
# Run from project root
bash scripts/mainnet-preflight.sh
```

### CI/CD Integration

```bash
# In your deployment pipeline
if bash scripts/mainnet-preflight.sh; then
    echo "✓ Preflight passed - proceeding with deployment"
    docker-compose up -d
else
    echo "✗ Preflight failed - deployment aborted"
    exit 1
fi
```

### Docker Integration

Add to your `docker-compose.yml` or deployment script:

```yaml
services:
  backend:
    image: stellar-greenpay-backend
    command: >
      bash -c "
        bash /app/scripts/mainnet-preflight.sh &&
        npm start
      "
```

## Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `STELLAR_NETWORK` | Must be "mainnet" | `mainnet` |
| `STELLAR_RPC_URL` | Stellar mainnet RPC endpoint | `https://soroban-mainnet.stellar.org` |
| `CONTRACT_ID` | Deployed contract identifier | `CCXXX...` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `WEBHOOK_URL` | HTTPS webhook endpoint | `https://api.example.com/webhook` |

## Validation Checks

### 1. Environment Variables ✓
- Verifies all required variables are set and non-empty
- Fails immediately if any critical variable is missing

### 2. Network Enforcement ✓
- Ensures `STELLAR_NETWORK=mainnet`
- Prevents accidental testnet deployments

### 3. Contract Verification ✓
- Validates contract exists on mainnet
- Uses Stellar CLI or JSON-RPC fallback
- Confirms contract initialization

### 4. Webhook Security ✓
- Enforces HTTPS protocol
- Validates URL format
- Blocks insecure HTTP webhooks

### 5. Database Health ✓
- Tests database connectivity
- Verifies migration status
- Ensures schema is up-to-date

### 6. Redis Connectivity ✓
- Pings Redis server
- Validates connection URL
- Ensures cache layer is available

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed - safe to deploy |
| `1` | One or more checks failed - DO NOT deploy |

## Output Format

```
╔═══════════════════════════════════════════════════════════╗
║     STELLAR GREENPAY MAINNET PREFLIGHT CHECK             ║
╚═══════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Checking Required Environment Variables
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[PASS] Environment variable 'STELLAR_NETWORK' is set
[PASS] Environment variable 'STELLAR_RPC_URL' is set
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Preflight Check Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Passed: 12
⚠ Warnings: 0
✗ Failed: 0

╔═══════════════════════════════════════════════════════════╗
║  ✓ ALL PREFLIGHT CHECKS PASSED                           ║
║  System is ready for mainnet deployment                  ║
╚═══════════════════════════════════════════════════════════╝
```

## Testing

Run the test suite to see both passing and failing scenarios:

```bash
bash scripts/test-mainnet-preflight.sh
```

## Dependencies

### Required
- `bash` (standard shell)
- `curl` (for RPC calls)

### Optional (Enhanced Functionality)
- `stellar` CLI - for contract verification
- `psql` - for database migration checks
- `redis-cli` - for Redis PING test
- `nc` (netcat) - for TCP connectivity fallback

## Common Failure Scenarios

### ❌ Wrong Network
```
[FAIL] STELLAR_NETWORK must be 'mainnet' but is set to 'testnet'
```
**Fix:** Update `.env` to set `STELLAR_NETWORK=mainnet`

### ❌ Insecure Webhook
```
[FAIL] WEBHOOK_URL uses insecure HTTP protocol
```
**Fix:** Update webhook to use HTTPS

### ❌ Contract Not Found
```
[FAIL] Contract does not appear to be deployed on mainnet
```
**Fix:** Deploy contract to mainnet before running preflight

### ❌ Database Unreachable
```
[FAIL] Cannot connect to database
```
**Fix:** Verify `DATABASE_URL` and network connectivity

## Best Practices

1. **Run Before Every Deployment**
   ```bash
   bash scripts/mainnet-preflight.sh && deploy.sh
   ```

2. **Add to CI/CD Pipeline**
   - Make preflight a required step
   - Block deployments on failure

3. **Monitor Warnings**
   - Warnings indicate missing tools, not failures
   - Install recommended dependencies for full validation

4. **Version Control**
   - Commit preflight results to deployment logs
   - Track validation history

## Troubleshooting

### Issue: "stellar: command not found"
The script will fall back to JSON-RPC verification. For full contract validation, install Stellar CLI:

```bash
# Install Stellar CLI
cargo install --locked stellar-cli --features opt
```

### Issue: "psql: command not found"
Database connectivity will use TCP check. For migration verification, install PostgreSQL client:

```bash
# Ubuntu/Debian
apt-get install postgresql-client

# macOS
brew install postgresql
```

### Issue: False Positive on Contract Check
If contract verification fails but you know it's deployed:
1. Verify `CONTRACT_ID` is correct
2. Check `STELLAR_RPC_URL` is accessible
3. Manually verify contract: `stellar contract read --id $CONTRACT_ID --network mainnet`

## Security Considerations

- ⚠️ Never log or expose sensitive environment variables
- ⚠️ Run preflight in secure CI/CD environment
- ⚠️ Webhook URLs must use HTTPS (enforced by script)
- ⚠️ Database credentials must use strong passwords

## Support

For issues or questions:
1. Check logs for specific failure messages
2. Review environment variable configuration
3. Verify network connectivity to external services
4. Consult deployment documentation

## License

Part of Stellar GreenPay project.
