"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
const pool = require("../db/pool");
const { buildDigestHtml, buildDigestText, runDigest } = require("./digestQueue");

describe("weekly update digest", () => {
  const projects = [{ project: { id: "project-1", name: "Solar Forest" }, updates: [{ id: "update-1", title: "First trees planted", body: "We planted one thousand trees.", url: "https://greenpay.test/updates/1" }], unsubscribeUrl: "https://api.test/unsubscribe" }];

  test("includes project name, update summary, full update link, and unsubscribe link", () => {
    const html = buildDigestHtml({ projects, weekLabel: "Jan 1–Jan 7", unsubscribeUrl: "https://greenpay.test/settings" });
    const text = buildDigestText({ projects, weekLabel: "Jan 1–Jan 7", unsubscribeUrl: "https://greenpay.test/settings" });
    expect(html).toContain("Solar Forest");
    expect(html).toContain("First trees planted");
    expect(html).toContain("https://greenpay.test/updates/1");
    expect(html).toContain("Unsubscribe from Solar Forest");
    expect(text).toContain("Manage subscriptions");
  });

  test("only queries active subscriptions and groups update rows by donor", async () => {
    delete process.env.RESEND_API_KEY;
    pool.query.mockResolvedValueOnce({ rows: [
      { email: "donor@example.com", project_id: "p1", name: "Project A", update_id: "u1", title: "A", body: "Body" },
      { email: "donor@example.com", project_id: "p2", name: "Project B", update_id: "u2", title: "B", body: "Body" },
    ] });
    await expect(runDigest(new Date("2026-01-12T12:00:00Z"))).resolves.toEqual({ sent: 0, donors: 1 });
    expect(pool.query.mock.calls[0][0]).toContain("ps.unsubscribed = false OR ps.unsubscribed IS NULL");
  });
});
