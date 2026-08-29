"use strict";

jest.mock("pg-boss", () => {
  const mockBoss = {
    on: jest.fn(),
    start: jest.fn(),
    schedule: jest.fn(),
    work: jest.fn(),
  };
  return function PgBoss() { return mockBoss; };
}, { virtual: true });
jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

// digestQueue captures RESEND_API_KEY / EMAIL_FROM / APP_URL / API_URL at
// module load time, so these must be set before requiring it.
process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "GreenPay <updates@greenpay.example>";
process.env.APP_URL = "https://greenpay.example";
process.env.API_URL = "https://api.greenpay.example";
process.env.UNSUBSCRIBE_SECRET = "test-secret";

const pool = require("../db/pool");
const logger = require("../logger");
const { runDigest } = require("./digestQueue");

global.fetch = jest.fn();

describe("runDigest", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UNSUBSCRIBE_SECRET = "test-secret";
    global.fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(""),
    });
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  test("no active projects with subscribers sends no emails", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await runDigest();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "digest_run_complete", sent: 0 }),
      expect.any(String),
    );
  });

  test("sends individual subscriber emails without exposing them to each other", async () => {
    const subscribers = [
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ];

    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: "project-1", name: "Forest Fund", co2_offset_kg: 1000 }],
      })
      .mockResolvedValueOnce({ rows: [{ raised_xlm: "25", donation_count: "2" }] })
      .mockResolvedValueOnce({ rows: [{ total: "100" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ title: "New trees", body: "Seedlings planted." }] })
      .mockResolvedValueOnce({ rows: subscribers.map((email) => ({ email })) });

    await runDigest();

    expect(global.fetch).toHaveBeenCalledTimes(subscribers.length);

    subscribers.forEach((subscriber, index) => {
      const [, request] = global.fetch.mock.calls[index];
      const payload = JSON.parse(request.body);

      expect(payload.to).toBe(subscriber);

      // Ensure other subscribers are not in this payload
      const otherSubscribers = subscribers.filter(s => s !== subscriber);
      for (const other of otherSubscribers) {
        expect(payload.to).not.toContain(other);
        expect(payload.from).not.toContain(other);
        expect(payload.subject).not.toContain(other);
        expect(JSON.stringify(payload.headers || {})).not.toContain(other);
      }
    });
  });
});
