"use strict";

describe("digestQueue email delivery privacy", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "GreenPay <updates@greenpay.example>",
      APP_URL: "https://greenpay.example",
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(""),
    });
  });

  afterEach(() => {
    process.env = OLD_ENV;
    delete global.fetch;
    jest.dontMock("../db/pool");
  });

  test("sends subscriber emails via BCC without exposing them in TO headers", async () => {
    const subscribers = [
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ];
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{ id: "project-1", name: "Forest Fund", co2_offset_kg: 1000 }],
        })
        .mockResolvedValueOnce({ rows: [{ raised_xlm: "25", donation_count: "2" }] })
        .mockResolvedValueOnce({ rows: [{ total: "100" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ title: "New trees", body: "Seedlings planted." }] })
        .mockResolvedValueOnce({ rows: subscribers.map((email) => ({ email })) }),
    };

    jest.doMock("../db/pool", () => pool);

    const { runDigest } = require("./digestQueue");
    await runDigest();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [, request] = global.fetch.mock.calls[0];
    const payload = JSON.parse(request.body);

    expect(payload.to).toBe(process.env.EMAIL_FROM);
    expect(payload.bcc).toEqual(subscribers);

    for (const subscriber of subscribers) {
      expect(payload.to).not.toContain(subscriber);
      expect(payload.from).not.toContain(subscriber);
      expect(payload.subject).not.toContain(subscriber);
      expect(JSON.stringify(payload.headers || {})).not.toContain(subscriber);
    }
  });
});
