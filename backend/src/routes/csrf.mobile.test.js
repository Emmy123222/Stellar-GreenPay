"use strict";

/**
 * csrf.mobile.test.js
 *
 * Integration tests verifying the selective CSRF strategy:
 *
 *  1. Mobile clients (/api/mobile/*) — no cookie, no CSRF token → 200 / not-403
 *  2. Extension clients (/api/extension/*) — same conditions → not-403
 *  3. Browser routes remain protected — no token → 403
 *  4. Browser routes pass with a valid CSRF token → not-403
 *  5. Unit-level tests for the isCsrfExempt helper
 */

const request = require("supertest");
const app = require("../server");
const { isCsrfExempt } = require("../middleware/selectiveCsrf");

// ── Unit tests: isCsrfExempt ────────────────────────────────────────────────
describe("isCsrfExempt()", () => {
  it.each([
    ["/api/mobile/donations", true],
    ["/api/mobile/projects", true],
    ["/api/mobile/ratings", true],
    ["/api/extension/donations", true],
    ["/api/extension/projects", true],
    ["/api/extension/ratings", true],
    ["/api/notifications", true],
    ["/api/v1/notifications", true],
    ["/health", true],
    ["/api/health", true],
    ["/api/v1/health", true],
    ["/api/readiness", true],
    ["/api/donations", false],
    ["/api/v1/projects", false],
    ["/api/ratings", false],
    ["/api/mobile-other", false],  // prefix must end with /
  ])("isCsrfExempt(%s) === %s", (path, expected) => {
    expect(isCsrfExempt(path)).toBe(expected);
  });
});

// ── Integration tests ───────────────────────────────────────────────────────

/**
 * Mobile client — no cookie jar, no CSRF token.
 * Ratings POST is a representative mutating endpoint.
 * The mobile router delegates to the same ratings handler, which may return
 * 400 (bad body) or some other non-403 code, but must never return 403 CSRF.
 */
describe("Mobile client (no cookie / no CSRF token)", () => {
  it("POST /api/mobile/ratings does NOT return 403 CSRF error", async () => {
    const res = await request(app)
      .post("/api/mobile/ratings")
      .set("Content-Type", "application/json")
      .send({
        projectId: "project-mobile-test",
        donorAddress: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN",
        rating: 5,
      });

    expect(res.status).not.toBe(403);
  });

  it("POST /api/mobile/donations does NOT return 403 CSRF error", async () => {
    const res = await request(app)
      .post("/api/mobile/donations")
      .set("Content-Type", "application/json")
      .send({
        txHash: "abc123",
        projectId: "proj-1",
        donorAddress: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN",
        amountXlm: "10",
      });

    expect(res.status).not.toBe(403);
  });

  it("GET /api/mobile/projects returns a non-403 response", async () => {
    const res = await request(app).get("/api/mobile/projects");
    expect(res.status).not.toBe(403);
  });
});

/**
 * Extension client — same conditions.
 */
describe("Extension client (no cookie / no CSRF token)", () => {
  it("POST /api/extension/ratings does NOT return 403 CSRF error", async () => {
    const res = await request(app)
      .post("/api/extension/ratings")
      .set("Content-Type", "application/json")
      .send({
        projectId: "project-ext-test",
        donorAddress: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN",
        rating: 4,
      });

    expect(res.status).not.toBe(403);
  });

  it("GET /api/extension/projects returns a non-403 response", async () => {
    const res = await request(app).get("/api/extension/projects");
    expect(res.status).not.toBe(403);
  });
});

/**
 * Browser routes remain CSRF-protected.
 *
 * We use POST /api/v1/projects because it is mounted in server.js and has no
 * auth guard — meaning the csurf middleware fires before any route logic, so a
 * missing token reliably produces 403 rather than 401 or 404.
 * (/api/v1/ratings is NOT mounted in server.js and would fall through to the
 * 404 handler instead of triggering the CSRF check.)
 */
describe("Browser routes — CSRF still enforced", () => {
  const agent = request.agent(app);

  it("POST /api/v1/projects without CSRF token returns 403", async () => {
    const res = await agent
      .post("/api/v1/projects")
      .set("Content-Type", "application/json")
      .send({
        name: "Test Project",
        description: "desc",
        location: "Earth",
        category: "reforestation",
        wallet_address: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.toLowerCase()).toContain("csrf");
  });

  it("POST /api/v1/projects WITH valid CSRF token succeeds (not 403)", async () => {
    const tokenRes = await agent.get("/api/v1/csrf-token").expect(200);
    const token = tokenRes.body.csrfToken;

    const res = await agent
      .post("/api/v1/projects")
      .set("X-CSRF-Token", token)
      .set("Content-Type", "application/json")
      .send({
        name: "Test Project",
        description: "desc",
        location: "Earth",
        category: "reforestation",
        wallet_address: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN",
      });

    expect(res.status).not.toBe(403);
  });
});
