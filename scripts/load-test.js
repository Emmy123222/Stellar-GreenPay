import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const donationLatency = new Trend('donation_latency', true);
const donationErrors = new Counter('donation_errors');
const successRate = new Rate('donation_success_rate');

// ── Scenarios ─────────────────────────────────────────────────────────────────
//
// sustained  — 100 VUs for 60 s (baseline, mirrors issue #149 acceptance criteria)
// ramp-up    — 0 → 100 VUs over 30 s, hold 60 s, ramp down 30 s
//
// Run baseline:     k6 run scripts/load-test.js
// Run ramp-up:      SCENARIO=ramp-up k6 run scripts/load-test.js

const SCENARIO = __ENV.SCENARIO || 'sustained';

export const options = {
  // Only the selected scenario is registered. The previous guard set `exec: '_noop'`
// on the other one, but its virtual users still started: they spun on an empty
// function for the whole run, so "baseline" actually measured the constant 100 VUs
// *and* ran a ramp profile alongside them (200 VUs peak, 83 million no-op iterations
// in a 60-second run). Selecting one scenario is what the header above already
// claims happens.
  scenarios: SCENARIO === 'ramp-up'
    ? {
        'ramp-up': {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { target: 100, duration: '30s' },
            { target: 100, duration: '60s' },
            { target: 0,   duration: '30s' },
          ],
        },
      }
    : {
        sustained: {
          executor: 'constant-vus',
          vus: 100,
          duration: '60s',
        },
      },
  thresholds: {
    // Acceptance criteria from issue #1182: p95 under 500 ms and an error rate
    // under 0.1%. The error thresholds used to allow 1%, which is ten times the
    // budget the issue sets.
    donation_latency:       ['p(95)<500'],
    donation_success_rate:  ['rate>0.999'],
    http_req_failed:        ['rate<0.001'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

// `projects.id` is a UUID, so the old `project-${n}` placeholders could never match a
// row: every request came back 404 and the run measured the lookup failure, not the
// donation path. The id is taken from the environment and `.github/workflows/load-test.yml`
// seeds exactly this project before the run.
//
// The run also needs the transaction-hash check to pass. `scripts/stub-horizon.js`
// serves that in CI via HORIZON_URL; against a real Horizon every hash here would be
// rejected as unconfirmed, so a local run against production Horizon measures 400s.
const PROJECT_ID = __ENV.PROJECT_ID || '11111111-1111-4111-8111-111111111111';

// Valid Stellar testnet public keys (G... 56-char base32)
const SAMPLE_ADDRESSES = [
  'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3A73ZFMZE',
  'GBVNNPOFVILBYQZLTDAL2QXAHVDYCSQXFMOUQ73XU3NKLHZB6KPRSEV',
  'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGBQH9L3BKQBFHV7HJZQZD',
  'GDNSSYSCSSRY3VWUQGGZXFPXDPWKJTMV6GCRXFCTQHK63CG4K5UEFSV',
  'GDQJUTQYK2MQX2CNYPCAETIQZRDZYOUC5RLAOBOVPPFBQ6TMHKCMB4PT',
];

// Deterministically generate unique-ish 64-char hex tx hashes per VU + iteration
// so the deduplication check in recordDonation doesn't collapse all requests to one.
function fakeTxHash(vuId, iter) {
  const base = `${vuId.toString(16).padStart(8, '0')}${iter.toString(16).padStart(8, '0')}`;
  return (base + '0'.repeat(64)).slice(0, 64);
}

export function _noop() {}

export default function () {
  const donor    = SAMPLE_ADDRESSES[__VU % SAMPLE_ADDRESSES.length];
  const txHash   = fakeTxHash(__VU, __ITER);
  const amountXLM = (Math.random() * 9 + 1).toFixed(7);

  const payload = JSON.stringify({
    projectId:       PROJECT_ID,
    amountXLM,
    donorAddress:    donor,
    transactionHash: txHash,
    memo:            'load-test',
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags:    { endpoint: 'POST /api/donations' },
  };

  const res = http.post(`${BASE_URL}/api/donations`, payload, params);

  donationLatency.add(res.timings.duration);

  const ok = check(res, {
    'status is 2xx':          (r) => r.status >= 200 && r.status < 300,
    'response has donationId or success': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!(body.donationId ?? body.data?.id ?? body.success);
      } catch {
        return false;
      }
    },
  });

  successRate.add(ok ? 1 : 0);
  if (!ok) donationErrors.add(1);

  sleep(0.5 + Math.random() * 0.5);
}
