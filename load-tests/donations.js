import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.BASE_URL || 'https://staging.greenpay.app';
const payload = __ENV.DONATION_PAYLOAD || JSON.stringify({
  projectId: 'load-test-project',
  donorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  amountXLM: 1,
  currency: 'XLM',
  transactionHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function donationLoad() {
  const response = http.post(`${baseUrl}/api/donations`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'donations' },
  });
  check(response, { 'donation endpoint responds': (res) => res.status < 500 });
}
