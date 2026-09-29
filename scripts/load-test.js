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
// Required fixtures: PROJECT_ID=<existing UUID> TX_HASHES=<existing tx hash,...>
// Run the API under test with DONATIONS_RATE_LIMIT_PER_MINUTE above the test request rate.

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
const PROJECT_ID = __ENV.PROJECT_ID;
const TX_HASHES = (__ENV.TX_HASHES || '').split(',').map((hash) => hash.trim()).filter(Boolean);

// Valid Stellar testnet public keys (G... 56-char base32)
const SAMPLE_ADDRESSES = [
  'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3A73ZFMZE',
  'GBVNNPOFVILBYQZLTDAL2QXAHVDYCSQXFMOUQ73XU3NKLHZB6KPRSEV',
  'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGBQH9L3BKQBFHV7HJZQZD',
  'GDNSSYSCSSRY3VWUQGGZXFPXDPWKJTMV6GCRXFCTQHK63CG4K5UEFSV',
  'GDQJUTQYK2MQX2CNYPCAETIQZRDZYOUC5RLAOBOVPPFBQ6TMHKCMB4PT',
];

export function setup() {
  if (!PROJECT_ID) {
    throw new Error('Set PROJECT_ID to an existing project UUID');
  }
  if (TX_HASHES.length === 0 || TX_HASHES.some((hash) => !/^[a-fA-F0-9]{64}$/.test(hash))) {
    throw new Error('Set TX_HASHES to comma-separated hashes of existing donations');
  }
}

export function _noop() {}

export default function () {
  const donor    = SAMPLE_ADDRESSES[__VU % SAMPLE_ADDRESSES.length];
  const txHash   = TX_HASHES[__ITER % TX_HASHES.length];
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
