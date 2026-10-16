"use strict";

/**
 * src/routes/routers.smoke.test.js
 *
 * Smoke tests for the newly mounted extension, mobile, and price routers,
 * verifying they respond on both /api and /api/v1 prefixes and that non-browser
 * clients are exempt from CSRF validation.
 */

const request = require("supertest");
const app = require("../server");

describe("Router mount smoke tests (/api and /api/v1)", () => {
  describe("Price router", () => {
    it("GET /api/price responds with 200 and rate payload", async () => {
      const res = await request(app).get("/api/price");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.xlmPerUsdc).toBe("number");
      expect(typeof res.body.data.usdPerXlm).toBe("number");
    });

    it("GET /api/v1/price responds with 200 and rate payload", async () => {
      const res = await request(app).get("/api/v1/price");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.xlmPerUsdc).toBe("number");
      expect(typeof res.body.data.usdPerXlm).toBe("number");
    });

    it("GET /api/price/xlm-usdc responds with 200 and rate payload", async () => {
      const res = await request(app).get("/api/price/xlm-usdc");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.xlmPerUsdc).toBe("number");
      expect(typeof res.body.data.usdPerXlm).toBe("number");
    });

    it("GET /api/v1/price/xlm-usdc responds with 200 and rate payload", async () => {
      const res = await request(app).get("/api/v1/price/xlm-usdc");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.xlmPerUsdc).toBe("number");
      expect(typeof res.body.data.usdPerXlm).toBe("number");
    });
  });

  describe("Extension router", () => {
    it("GET /api/extension responds with 200 and client identifier", async () => {
      const res = await request(app).get("/api/extension");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.service).toBe("extension-api");
    });

    it("GET /api/v1/extension responds with 200 and client identifier", async () => {
      const res = await request(app).get("/api/v1/extension");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.service).toBe("extension-api");
    });

    it("GET /api/extension/projects is mounted and responds", async () => {
      const res = await request(app).get("/api/extension/projects");
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(403);
    });

    it("GET /api/v1/extension/projects is mounted and responds", async () => {
      const res = await request(app).get("/api/v1/extension/projects");
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(403);
    });

    it("POST /api/v1/extension/ratings is exempt from CSRF token requirement", async () => {
      const res = await request(app)
        .post("/api/v1/extension/ratings")
        .set("Content-Type", "application/json")
        .send({
          projectId: "project-ext-test",
          donorAddress: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN",
          rating: 4,
        });
      expect(res.status).not.toBe(403);
    });
  });

  describe("Mobile router", () => {
    it("GET /api/mobile responds with 200 and client identifier", async () => {
      const res = await request(app).get("/api/mobile");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.service).toBe("mobile-api");
    });

    it("GET /api/v1/mobile responds with 200 and client identifier", async () => {
      const res = await request(app).get("/api/v1/mobile");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.service).toBe("mobile-api");
    });

    it("GET /api/mobile/projects is mounted and responds", async () => {
      const res = await request(app).get("/api/mobile/projects");
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(403);
    });

    it("GET /api/v1/mobile/projects is mounted and responds", async () => {
      const res = await request(app).get("/api/v1/mobile/projects");
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(403);
    });

    it("POST /api/v1/mobile/ratings is exempt from CSRF token requirement", async () => {
      const res = await request(app)
        .post("/api/v1/mobile/ratings")
        .set("Content-Type", "application/json")
        .send({
          projectId: "project-mobile-test",
          donorAddress: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3EHDCPQKN",
          rating: 5,
        });
      expect(res.status).not.toBe(403);
    });
  });
});
