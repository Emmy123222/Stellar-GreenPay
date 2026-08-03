# Stellar GreenPay - Mainnet Deployment Checklist

Use this checklist to ensure a smooth and safe mainnet deployment.

---

## ⏰ Timeline: T-7 Days to Launch

### Week Before Deployment

- [ ] **Review All Documentation**
  - [ ] Read [`MAINNET-DEPLOYMENT.md`](MAINNET-DEPLOYMENT.md)
  - [ ] Review [`scripts/PREFLIGHT-README.md`](scripts/PREFLIGHT-README.md)
  - [ ] Bookmark [`scripts/QUICK-REFERENCE.md`](scripts/QUICK-REFERENCE.md)

- [ ] **Infrastructure Preparation**
  - [ ] Production database provisioned
  - [ ] Redis instance configured
  - [ ] Load balancers configured
  - [ ] SSL/TLS certificates installed
  - [ ] DNS records configured
  - [ ] Firewall rules reviewed

- [ ] **Security Review**
  - [ ] All secrets rotated from testnet
  - [ ] Secrets management system configured (Vault/AWS Secrets Manager)
  - [ ] Security audit completed
  - [ ] Penetration testing done
  - [ ] CORS origins configured
  - [ ] Rate limiting tested

---

## ⏰ Timeline: T-3 Days to Launch

### Three Days Before Deployment

- [ ] **Smart Contract Verification**
  - [ ] Contract deployed to Stellar mainnet
  - [ ] Contract ID documented
  - [ ] Contract initialization verified
  - [ ] Contract admin keys secured in vault
  - [ ] Contract functionality tested on mainnet

- [ ] **Environment Configuration**
  - [ ] Copy `.env.mainnet.example` to `.env.mainnet`
  - [ ] Update all placeholder values
  - [ ] Verify `STELLAR_NETWORK=mainnet`
  - [ ] Confirm `WEBHOOK_URL` uses HTTPS
  - [ ] Test all external service connections

- [ ] **Database Preparation**
  - [ ] Production database schema reviewed
  - [ ] All migrations tested in staging
  - [ ] Migration rollback procedures documented
  - [ ] Backup strategy tested and verified
  - [ ] Connection pooling configured

---

## ⏰ Timeline: T-1 Day to Launch

### Day Before Deployment

- [ ] **Monitoring & Observability**
  - [ ] Sentry/error tracking configured
  - [ ] Logging pipeline active
  - [ ] Metrics dashboards created
  - [ ] Alerts configured and tested
  - [ ] On-call rotation scheduled

- [ ] **Run Preflight Check (Test)**
  ```bash
  bash scripts/test-mainnet-preflight.sh
  ```
  - [ ] All test scenarios pass
  - [ ] Failure cases properly detected
  - [ ] Error messages clear and actionable

- [ ] **Team Preparation**
  - [ ] Deployment runbook reviewed
  - [ ] Rollback procedures tested
  - [ ] Emergency contacts confirmed
  - [ ] Communication channels ready (Slack/Teams)
  - [ ] Post-deployment verification plan ready

---

## ⏰ Timeline: T-0 (Deployment Day)

### Pre-Deployment (1 Hour Before)

- [ ] **Final Environment Validation**
  ```bash
  # Load production environment
  source .env.mainnet
  
  # Verify all variables
  echo "Network: $STELLAR_NETWORK"
  echo "RPC URL: $STELLAR_RPC_URL"
  echo "Contract: $CONTRACT_ID"
  ```

- [ ] **Run Mainnet Preflight Check**
  ```bash
  bash scripts/mainnet-preflight.sh
  ```
  - [ ] Exit code is `0` (success)
  - [ ] All `[PASS]` indicators green
  - [ ] Zero `[FAIL]` messages
  - [ ] Warnings reviewed and acceptable

- [ ] **Pre-Deployment Backup**
  - [ ] Current database backed up
  - [ ] Backup restoration tested
  - [ ] Backup location documented

---

### Deployment Execution

- [ ] **Start Deployment**
  ```bash
  # Run preflight one final time
  bash scripts/mainnet-preflight.sh || exit 1
  
  # Deploy application
  docker-compose -f docker-compose.mainnet.yml up -d
  ```

- [ ] **Initial Health Checks**
  - [ ] Application started successfully
  - [ ] Health endpoint responding: `/health`
  - [ ] Readiness endpoint responding: `/readiness`
  - [ ] No errors in logs (first 5 minutes)

---

### Post-Deployment Verification (First 30 Minutes)

- [ ] **Functional Testing**
  - [ ] User authentication working
  - [ ] Wallet connection successful
  - [ ] Smart contract interactions functional
  - [ ] Database queries performing well
  - [ ] Cache (Redis) hit rates normal

- [ ] **API Endpoint Testing**
  ```bash
  # Health check
  curl -f https://api.greenpay.example.com/health
  
  # Projects endpoint
  curl -f https://api.greenpay.example.com/api/v1/projects
  
  # Donations endpoint (with auth)
  curl -f -H "Authorization: Bearer $TOKEN" \
    https://api.greenpay.example.com/api/v1/donations
  ```

- [ ] **Monitoring Validation**
  - [ ] Metrics flowing to dashboards
  - [ ] Logs appearing in aggregation system
  - [ ] Error tracking operational (Sentry)
  - [ ] No unexpected alerts firing

- [ ] **Performance Metrics**
  - [ ] Response times within SLA (<500ms for 95th percentile)
  - [ ] Database connection pool healthy
  - [ ] Redis memory usage normal
  - [ ] CPU/Memory utilization acceptable

---

### Post-Deployment Verification (First Hour)

- [ ] **Transaction Testing**
  - [ ] Test donation transaction (small amount)
  - [ ] Transaction confirmed on Stellar mainnet
  - [ ] Transaction reflected in database
  - [ ] Webhook notifications triggered
  - [ ] User balance updated correctly

- [ ] **Security Verification**
  - [ ] HTTPS enforced (no HTTP fallback)
  - [ ] CORS headers correct
  - [ ] Rate limiting active
  - [ ] Authentication working
  - [ ] Authorization policies enforced

- [ ] **Integration Testing**
  - [ ] Stellar Horizon integration functional
  - [ ] Smart contract reads/writes working
  - [ ] Database queries optimized
  - [ ] Redis caching effective
  - [ ] External webhooks delivering

---

### Post-Deployment Verification (First 24 Hours)

- [ ] **Extended Monitoring**
  - [ ] No critical errors in logs
  - [ ] Performance metrics stable
  - [ ] Resource utilization normal
  - [ ] No memory leaks detected
  - [ ] Database performance acceptable

- [ ] **User Acceptance**
  - [ ] Internal team testing complete
  - [ ] Beta user feedback positive
  - [ ] No critical bugs reported
  - [ ] Support tickets reviewed

- [ ] **Documentation Updates**
  - [ ] Deployment timestamp recorded
  - [ ] Contract addresses documented
  - [ ] Known issues list updated
  - [ ] Runbook updated with learnings

---

## 🚨 Rollback Criteria

**Initiate rollback immediately if:**

- ❌ Preflight check fails (exit code 1)
- ❌ Application fails to start
- ❌ Critical errors in first 5 minutes
- ❌ Smart contract interactions failing
- ❌ Database corruption detected
- ❌ Security vulnerability discovered
- ❌ Performance degradation >50%
- ❌ Data loss or inconsistency

---

## 🔄 Rollback Procedure

If rollback is needed:

1. **Stop Current Deployment**
   ```bash
   docker-compose -f docker-compose.mainnet.yml down
   ```

2. **Restore Previous Version**
   ```bash
   git checkout <previous-stable-tag>
   docker-compose -f docker-compose.mainnet.yml up -d
   ```

3. **Restore Database (if needed)**
   ```bash
   psql $DATABASE_URL < backup-pre-deployment.sql
   ```

4. **Verify Rollback**
   ```bash
   bash scripts/mainnet-preflight.sh
   curl -f https://api.greenpay.example.com/health
   ```

5. **Post-Mortem**
   - Document what went wrong
   - Identify root cause
   - Update deployment checklist
   - Schedule retry after fixes

---

## 📊 Success Criteria

Deployment is considered successful when:

- ✅ Preflight check passes (exit code 0)
- ✅ Application running for 1 hour without critical errors
- ✅ All functional tests pass
- ✅ Performance metrics within SLA
- ✅ No security issues detected
- ✅ User transactions processing correctly
- ✅ Monitoring and alerts operational
- ✅ Team confident in deployment stability

---

## 📞 Emergency Contacts

| Role | Contact | Availability |
|------|---------|--------------|
| DevOps Lead | [Name/Slack] | 24/7 during deployment |
| Backend Lead | [Name/Slack] | 24/7 during deployment |
| Security Lead | [Name/Slack] | On-call |
| Infrastructure | [Team Channel] | 24/7 |

---

## 📝 Deployment Log Template

```markdown
# Deployment Log - [Date]

## Pre-Deployment
- Preflight Check: [PASS/FAIL]
- Team Ready: [YES/NO]
- Start Time: [HH:MM UTC]

## Deployment
- Deployment Started: [HH:MM UTC]
- Deployment Completed: [HH:MM UTC]
- Issues Encountered: [None / List issues]

## Post-Deployment
- Health Check: [PASS/FAIL]
- First Transaction: [HH:MM UTC]
- 1 Hour Check: [PASS/FAIL]
- 24 Hour Check: [PASS/FAIL]

## Metrics
- Response Time (p95): [XXX ms]
- Error Rate: [X.XX%]
- Uptime: [XX.XX%]

## Notes
[Any additional observations or issues]

## Sign-off
- DevOps: [Name] - [Timestamp]
- Backend: [Name] - [Timestamp]
- Security: [Name] - [Timestamp]
```

---

## 🎯 Final Reminder

**NEVER deploy to mainnet if:**
- Preflight check fails
- Any checklist item is incomplete
- Team is unavailable for monitoring
- Backup procedures are untested
- Rollback plan is unclear

**Remember:** It's always better to delay deployment than to rush and risk production issues.

---

## ✅ Sign-off

Before deployment, obtain sign-off from:

- [ ] **DevOps Lead** - Infrastructure ready
- [ ] **Backend Lead** - Application ready
- [ ] **Security Lead** - Security review complete
- [ ] **Product Owner** - Feature acceptance complete

**Deployment Authorized By:**

- Name: ___________________________
- Role: ___________________________
- Date: ___________________________
- Time: ___________________________

---

**Last Updated:** 2026-07-30  
**Version:** 1.0.0  
**Next Review:** After first deployment
