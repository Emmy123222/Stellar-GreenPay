# Mainnet Preflight Check - Quick Reference Card

## 🚀 One-Line Deployment Check

```bash
bash scripts/mainnet-preflight.sh && echo "✓ Ready to deploy" || echo "✗ Fix issues before deploying"
```

---

## 📋 Required Environment Variables

| Variable | Must Be |
|----------|---------|
| `STELLAR_NETWORK` | `mainnet` |
| `STELLAR_RPC_URL` | Valid HTTPS URL |
| `CONTRACT_ID` | Deployed contract ID |
| `DATABASE_URL` | Valid PostgreSQL URL |
| `REDIS_URL` | Valid Redis URL |
| `WEBHOOK_URL` | Valid HTTPS URL (NOT http) |

---

## ✅ What Gets Checked

1. **Environment Variables** - All required vars set
2. **Network Validation** - Must be mainnet (NOT testnet)
3. **Contract Verification** - Exists on Stellar mainnet
4. **Webhook Security** - HTTPS only (blocks HTTP)
5. **Database Health** - Connectivity + migrations
6. **Redis Connectivity** - Server responds to PING

---

## 🎯 Exit Codes

- **`0`** = All checks passed → **Safe to deploy**
- **`1`** = One or more failed → **DO NOT deploy**

---

## ⚡ Quick Setup

```bash
# 1. Make executable
chmod +x scripts/mainnet-preflight.sh

# 2. Set environment
export STELLAR_NETWORK=mainnet
export STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
export CONTRACT_ID=your_contract_id
export DATABASE_URL=postgresql://user:pass@host:5432/db
export REDIS_URL=redis://host:6379
export WEBHOOK_URL=https://api.example.com/webhook

# 3. Run check
bash scripts/mainnet-preflight.sh
```

---

## 🔧 Common Fixes

| Error | Fix |
|-------|-----|
| `STELLAR_NETWORK != mainnet` | `export STELLAR_NETWORK=mainnet` |
| `WEBHOOK_URL uses HTTP` | Change to `https://...` |
| `Contract not found` | Deploy contract first |
| `Database unreachable` | Check `DATABASE_URL` & network |
| `Redis connection failed` | Verify `REDIS_URL` & firewall |

---

## 🐳 Docker Integration

```dockerfile
CMD ["sh", "-c", "bash scripts/mainnet-preflight.sh && npm start"]
```

---

## 🔄 CI/CD Integration

```yaml
- name: Preflight Check
  run: bash scripts/mainnet-preflight.sh
  
- name: Deploy
  if: success()
  run: ./deploy.sh
```

---

## 📊 Success Output

```
╔═══════════════════════════════════════╗
║  ✓ ALL PREFLIGHT CHECKS PASSED       ║
║  System is ready for mainnet         ║
╚═══════════════════════════════════════╝

✓ Passed: 12
⚠ Warnings: 0
✗ Failed: 0
```

---

## ⚠️ NEVER Deploy If:

- ❌ Exit code is `1`
- ❌ Any `[FAIL]` messages appear
- ❌ Network is not `mainnet`
- ❌ Webhook uses `http://`

---

## 📚 Full Documentation

- **Complete Guide:** [MAINNET-DEPLOYMENT.md](../MAINNET-DEPLOYMENT.md)
- **Detailed README:** [PREFLIGHT-README.md](PREFLIGHT-README.md)
- **Example Config:** [.env.mainnet.example](../.env.mainnet.example)

---

## 🆘 Emergency Contacts

If preflight fails and you need help:
1. Check error messages in output
2. Review [PREFLIGHT-README.md](PREFLIGHT-README.md)
3. Contact DevOps team
4. DO NOT bypass checks

---

**Remember:** This script prevents production failures. Trust it. 🛡️
