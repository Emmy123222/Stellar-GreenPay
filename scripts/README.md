# Scripts Directory

This directory contains deployment, maintenance, and operational scripts for Stellar GreenPay.

---

## 🚀 Mainnet Preflight Check System

### Quick Start

```bash
# Run preflight check before mainnet deployment
bash scripts/mainnet-preflight.sh
```

**Exit Codes:**
- `0` = All checks passed → Safe to deploy ✅
- `1` = One or more checks failed → DO NOT deploy ❌

---

## 📁 Files Overview

### Core Scripts

| File | Purpose | Usage |
|------|---------|-------|
| **`mainnet-preflight.sh`** | Pre-deployment validation script | `bash scripts/mainnet-preflight.sh` |
| **`test-mainnet-preflight.sh`** | Test suite for preflight checks | `bash scripts/test-mainnet-preflight.sh` |

### Documentation

| File | Description |
|------|-------------|
| **`QUICK-REFERENCE.md`** | One-page cheat sheet for quick access |
| **`PREFLIGHT-README.md`** | Complete preflight check documentation |
| **`IMPLEMENTATION-SUMMARY.md`** | Technical implementation details |

---

## 🎯 What Gets Validated

The mainnet preflight check validates:

1. ✅ **Environment Variables** - All required vars set
2. ✅ **Network Configuration** - Must be mainnet (not testnet)
3. ✅ **Smart Contract** - Deployed and initialized on mainnet
4. ✅ **Webhook Security** - HTTPS enforcement (blocks HTTP)
5. ✅ **Database Health** - Connectivity and migration status
6. ✅ **Redis Connectivity** - Cache server availability

---

## 📋 Required Environment Variables

```bash
export STELLAR_NETWORK=mainnet
export STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
export CONTRACT_ID=your_contract_id
export DATABASE_URL=postgresql://user:pass@host:5432/db
export REDIS_URL=redis://host:6379
export WEBHOOK_URL=https://api.example.com/webhook
```

See [`.env.mainnet.example`](../.env.mainnet.example) for complete configuration template.

---

## 🔧 Integration Examples

### Deployment Script

```bash
#!/bin/bash
set -e

# Run preflight check
bash scripts/mainnet-preflight.sh || {
    echo "❌ Preflight failed - aborting"
    exit 1
}

# Deploy application
docker-compose up -d
```

### CI/CD Pipeline (GitHub Actions)

```yaml
- name: Mainnet Preflight Check
  run: bash scripts/mainnet-preflight.sh
  env:
    STELLAR_NETWORK: mainnet
    STELLAR_RPC_URL: ${{ secrets.STELLAR_RPC_URL }}
    CONTRACT_ID: ${{ secrets.CONTRACT_ID }}
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    REDIS_URL: ${{ secrets.REDIS_URL }}
    WEBHOOK_URL: ${{ secrets.WEBHOOK_URL }}

- name: Deploy
  if: success()
  run: ./deploy.sh
```

### Docker

```dockerfile
CMD ["sh", "-c", "bash scripts/mainnet-preflight.sh && npm start"]
```

---

## 📖 Documentation

### Quick Access
- **Need help fast?** → [`QUICK-REFERENCE.md`](QUICK-REFERENCE.md)
- **Full documentation?** → [`PREFLIGHT-README.md`](PREFLIGHT-README.md)
- **Deployment guide?** → [`../MAINNET-DEPLOYMENT.md`](../MAINNET-DEPLOYMENT.md)
- **Technical details?** → [`IMPLEMENTATION-SUMMARY.md`](IMPLEMENTATION-SUMMARY.md)

---

## 🧪 Testing

Run the test suite to see preflight validation in action:

```bash
bash scripts/test-mainnet-preflight.sh
```

Tests include:
- Missing environment variables
- Wrong network configuration
- Insecure HTTP webhooks
- Valid mainnet configuration

---

## 🔒 Security Notes

- **HTTPS Required:** Webhook URLs must use HTTPS
- **Mainnet Only:** Prevents accidental testnet deployments
- **No Credential Exposure:** Secrets are validated but never logged
- **Fail-Safe:** Script uses `set -euo pipefail` for reliability

---

## 🛠️ Optional Dependencies

The script works without these but provides enhanced validation if installed:

| Tool | Purpose | Install |
|------|---------|---------|
| `stellar` | Contract verification | `cargo install stellar-cli` |
| `psql` | Database migration checks | `apt-get install postgresql-client` |
| `redis-cli` | Redis PING tests | `apt-get install redis-tools` |
| `nc` | TCP connectivity fallback | Built into most systems |

---

## 🐛 Troubleshooting

### Script Won't Execute
```bash
# Make script executable
chmod +x scripts/mainnet-preflight.sh
```

### "Command not found"
```bash
# Use bash explicitly
bash scripts/mainnet-preflight.sh
```

### Checks Failing

See detailed troubleshooting in:
- [`PREFLIGHT-README.md`](PREFLIGHT-README.md#troubleshooting)
- [`../MAINNET-DEPLOYMENT.md`](../MAINNET-DEPLOYMENT.md#troubleshooting)

---

## 📊 Output Example

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

✓ Passed: 12
⚠ Warnings: 0
✗ Failed: 0

╔═══════════════════════════════════════════════════════════╗
║  ✓ ALL PREFLIGHT CHECKS PASSED                           ║
║  System is ready for mainnet deployment                  ║
╚═══════════════════════════════════════════════════════════╝
```

---

## 🚦 Best Practices

1. **Always run before deployment**
   ```bash
   bash scripts/mainnet-preflight.sh && deploy.sh
   ```

2. **Integrate into CI/CD**
   - Make preflight a required pipeline step
   - Block deployments on failure

3. **Monitor warnings**
   - Install recommended tools for full validation
   - Review warning messages

4. **Never bypass failures**
   - Exit code `1` means DO NOT deploy
   - Fix issues before proceeding

---

## 🆘 Getting Help

1. Check error messages in script output
2. Review [`PREFLIGHT-README.md`](PREFLIGHT-README.md)
3. Consult [`QUICK-REFERENCE.md`](QUICK-REFERENCE.md)
4. Read [`../MAINNET-DEPLOYMENT.md`](../MAINNET-DEPLOYMENT.md)
5. Contact DevOps team

---

## 📝 Other Scripts

This directory may contain additional scripts for:
- Database migrations
- Backup operations
- Monitoring tasks
- Maintenance procedures

Check individual script documentation for details.

---

**Last Updated:** 2026-07-30  
**Maintainer:** DevOps Team  
**Version:** 1.0.0
