/**
 * email.test.js
 * Unit tests for transactional emails including recurring donation cancellations
 */
"use strict";

describe("email service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, RESEND_API_KEY: "re_test_123" };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email-123" }),
      text: async () => "ok",
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("sendRecurringDonationCancelledEmail", () => {
    it("dispatches cancellation email via Resend", async () => {
      const { sendRecurringDonationCancelledEmail } = require("./email");

      await sendRecurringDonationCancelledEmail({
        email: "donor@example.com",
        projectName: "Green Earth Project",
        donationId: "pledge-1",
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer re_test_123");

      const body = JSON.parse(options.body);
      expect(body.to).toEqual(["donor@example.com"]);
      expect(body.subject).toContain("Recurring Donation Cancelled: Green Earth Project");
      expect(body.html).toContain("Green Earth Project");
      expect(body.html).toContain("cancelled because the project has been deactivated");
    });

    it("skips if RESEND_API_KEY is missing", async () => {
      delete process.env.RESEND_API_KEY;
      const { sendRecurringDonationCancelledEmail } = require("./email");

      await sendRecurringDonationCancelledEmail({
        email: "donor@example.com",
        projectName: "Test Project",
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("skips if email is missing", async () => {
      const { sendRecurringDonationCancelledEmail } = require("./email");

      await sendRecurringDonationCancelledEmail({
        email: "",
        projectName: "Test Project",
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
