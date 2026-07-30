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
  scenarios: {
    sustained: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
      startTime: '0s',
      ...(SCENARIO !== 'sustained' && { exec: '_noop' }),
    },
    'ramp-up': {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { target: 100, duration: '30s' },
        { target: 100, duration: '60s' },
        { target: 0,   duration: '30s' },
      ],
      ...(SCENARIO !== 'ramp-up' && { exec: '_noop' }),
    },
  },
  thresholds: {
    // p95 must stay under 500 ms — see docs/performance.md for rationale
    donation_latency:       ['p(95)<500'],
    donation_success_rate:  ['rate>0.99'],
    http_req_failed:        ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

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
    projectId:       `project-${((__VU + __ITER) % 10) + 1}`,
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
