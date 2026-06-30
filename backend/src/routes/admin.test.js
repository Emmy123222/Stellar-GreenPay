"use strict";
const express = require("express");
const request = require("supertest");
const { signToken, adminRequired, adminKeyRequired } = require("../middleware/auth");

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "testpass";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.JWT_SECRET = "test-secret-for-jest";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", require("./admin"));
  return app;
}

describe("POST /api/admin/login", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  it("returns 401 when no credentials are sent", async () => {
    const res = await request(app).post("/api/admin/login").send({});
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong username", async () => {
    const res = await request(app).post("/api/admin/login").send({ username: "wrong", password: "testpass" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong password", async () => {
    const res = await request(app).post("/api/admin/login").send({ username: "admin", password: "wrongpass" });
    expect(res.status).toBe(401);
  });

  it("returns a token and refreshToken for valid credentials", async () => {
    const res = await request(app).post("/api/admin/login").send({ username: "admin", password: "testpass" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.expiresIn).toBe(3600);
  });

  it("returns 503 when ADMIN_PASSWORD is not configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    const res = await request(app).post("/api/admin/login").send({ username: "admin", password: "testpass" });
    expect(res.status).toBe(503);
    process.env.ADMIN_PASSWORD = "testpass";
  });
});

describe("POST /api/admin/refresh", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  it("returns 400 when no refreshToken is sent", async () => {
    const res = await request(app).post("/api/admin/refresh").send({});
    expect(res.status).toBe(400);
  });

  it("returns 401 for invalid refresh token", async () => {
    const res = await request(app).post("/api/admin/refresh").send({ refreshToken: "bogus" });
    expect(res.status).toBe(401);
  });

  it("returns a new token for a valid refresh token", async () => {
    const loginRes = await request(app).post("/api/admin/login").send({ username: "admin", password: "testpass" });
    const refreshToken = loginRes.body.data.refreshToken;

    const res = await request(app).post("/api/admin/refresh").send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.expiresIn).toBe(3600);
  });
});

describe("GET /api/admin/me", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  it("returns 401 without Authorization header", async () => {
    const res = await request(app).get("/api/admin/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed Authorization header", async () => {
    const res = await request(app).get("/api/admin/me").set("Authorization", "NotBearer token");
    expect(res.status).toBe(401);
  });

  it("returns 401 with expired token", async () => {
    const expired = signToken({ role: "admin" }, "0s");
    await new Promise((r) => setTimeout(r, 100));
    const res = await request(app).get("/api/admin/me").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("returns admin info with valid token", async () => {
    const loginRes = await request(app).post("/api/admin/login").send({ username: "admin", password: "testpass" });
    const token = loginRes.body.data.token;

    const res = await request(app).get("/api/admin/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.username).toBe("admin");
    expect(res.body.data.role).toBe("admin");
  });
});

describe("adminRequired middleware", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.get("/protected", adminRequired, (req, res) => res.json({ ok: true, user: req.admin }));
  });

  it("allows requests with valid token", async () => {
    const token = signToken({ role: "admin", sub: "admin" }, "1h");
    const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("allows requests with valid X-Admin-Key", async () => {
    const res = await request(app).get("/protected").set("X-Admin-Key", "test-admin-key");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.authMethod).toBe("x-admin-key");
  });
});

describe("adminKeyRequired middleware", () => {
  let app;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    delete process.env.ADMIN_API_KEYS;
    app = express();
    app.use(express.json());
    app.post("/protected", adminKeyRequired, (req, res) => res.json({ ok: true, user: req.admin }));
  });

  it("rejects requests without X-Admin-Key", async () => {
    const res = await request(app).post("/protected").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing X-Admin-Key header");
  });

  it("rejects requests with an invalid X-Admin-Key", async () => {
    const res = await request(app).post("/protected").set("X-Admin-Key", "wrong").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid X-Admin-Key header");
  });

  it("allows requests with the configured X-Admin-Key", async () => {
    const res = await request(app).post("/protected").set("X-Admin-Key", "test-admin-key").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.role).toBe("admin");
  });

  it("allows rotated comma-separated keys from ADMIN_API_KEYS", async () => {
    delete process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEYS = "old-key, new-key";

    const res = await request(app).post("/protected").set("X-Admin-Key", "new-key").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
