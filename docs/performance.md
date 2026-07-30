# Performance Targets

## POST /api/donations

| Metric | Target |
|--------|--------|
| p50 latency | < 150 ms |
| p95 latency | < 500 ms |
| p99 latency | < 1 000 ms |
| Error rate | < 1 % |
| Throughput (sustained) | ≥ 100 req/s |

These targets are validated by the k6 load test at `scripts/load-test.js`
(100 virtual users × 60 seconds). The p95 < 500 ms threshold is enforced as
a hard k6 `thresholds` check; the test exits with a non-zero status if it
is violated.

## Running the test

```bash
# Install k6: https://k6.io/docs/get-started/installation/
# brew install k6  (macOS)

# Against local dev server (default port 4000)
k6 run scripts/load-test.js

# Against a staging environment
BASE_URL=https://staging.greenpay.app k6 run scripts/load-test.js

# Ramp-up scenario (0 → 100 VUs over 30 s, hold 60 s, ramp down)
SCENARIO=ramp-up k6 run scripts/load-test.js

# Save raw metrics as JSON for later analysis
k6 run --out json=results.json scripts/load-test.js
```

### npm shortcut

```bash
cd backend
npm run load-test                                     # sustained (default)
BASE_URL=https://staging.greenpay.app npm run load-test
SCENARIO=ramp-up npm run load-test
```

## Understanding the thresholds

| Threshold | k6 expression | Meaning |
|-----------|--------------|---------|
| `donation_latency p(95)<500` | Hard | 95 % of requests must complete in < 500 ms |
| `donation_success_rate rate>0.99` | Hard | ≥ 99 % of checks must pass |
| `http_req_failed rate<0.01` | Hard | HTTP error rate must stay below 1 % |

A failed threshold causes k6 to exit with a non-zero status, which will fail the CI job.

## Interpreting results

After a run k6 prints a summary like:

```
donation_latency.........: avg=82ms  min=12ms  med=74ms  max=490ms  p(90)=140ms p(95)=210ms
http_reqs................: 5 823  96.99/s
```

Key columns to watch:

- **p(95)** — must stay under 500 ms per threshold
- **http_reqs / rate** — sustained throughput; target ≥ 100 req/s
- **http_req_failed** — any non-zero value here warrants investigation

## Baseline results (testnet, 2026-06-02)

_Run after initial backend deployment. Update this table after each significant
infrastructure change or after merging changes to the donations route._

| Metric | Result |
|--------|--------|
| p50 | — ms |
| p95 | — ms |
| p99 | — ms |
| Error rate | — % |
| Peak RPS | — |

> Fill in actual numbers by running `npm run load-test` against the target environment
> and copying the summary output here before merging backend changes that touch the
> donations route or the Stellar submission path.

## CI integration

Add the following step to `.github/workflows/ci.yml` to run the load test against a
short smoke profile on every PR that touches `backend/src/routes/donations.js`:

```yaml
- name: Install k6
  run: |
    curl -s https://dl.k6.io/key.gpg | sudo apt-key add -
    echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update && sudo apt-get install k6

- name: Donation route smoke load test
  run: k6 run --vus 10 --duration 10s scripts/load-test.js
  env:
    BASE_URL: http://localhost:4000
```
