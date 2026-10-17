"use strict";

const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const { createSelectiveCsrf } = require("./selectiveCsrf");

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(createSelectiveCsrf({
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "none",
      path: "/",
    },
    ignoreMethods: ["GET", "HEAD", "OPTIONS"],
  }));

  app.get("/api/csrf-token", (req, res) => {
    res.json({ success: true, csrfToken: req.csrfToken() });
  });
  app.post("/protected", (req, res) => res.json({ success: true }));
  app.post("/api/mobile/test", (req, res) => res.json({ success: true }));
  app.use((error, req, res, next) => {
    void next;
    res.status(error.status || 500).json({ error: error.message });
  });

  return app;
}

describe("selective CSRF middleware", () => {
  const app = createTestApp();

  it("issues a token and preserves the configured cookie options", async () => {
    const res = await request(app).get("/api/csrf-token").expect(200);

    expect(res.body).toEqual(expect.objectContaining({ success: true }));
    expect(res.body.csrfToken).toEqual(expect.any(String));
    expect(res.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(res.headers["set-cookie"][0]).toContain("SameSite=None");
    expect(res.headers["set-cookie"][0]).toContain("Path=/");
  });

  it("requires a valid token bound to the CSRF cookie", async () => {
    const agent = request.agent(app);
    const tokenRes = await agent.get("/api/csrf-token").expect(200);
    const token = tokenRes.body.csrfToken;

    await request(app).post("/protected").expect(403);
    await agent.post("/protected").set("X-CSRF-Token", `${token}tampered`).expect(403);
    await agent.post("/protected").set("X-CSRF-Token", token).expect(200);
  });

  it("continues to exempt mobile routes", async () => {
    await request(app).post("/api/mobile/test").expect(200);
  });

  it("regression #1521: server boots without merge-conflict leftovers", async () => {
    const fs = require("fs");
    const path = require("path");
    const serverPath = path.join(__dirname, "..", "server.js");
    const source = fs.readFileSync(serverPath, "utf8");

    // No unresolved merge markers or stray branch-name lines.
    expect(source).not.toMatch(/<<<<<<<|>>>>>>>|=======\r?\n/);
    expect(source).not.toMatch(/fix\/csrf-mobile-extension-clients/);
    expect(source).not.toMatch(/^\s*main\s*$/m);
    // The selective-CSRF variant must win over the legacy manual path.
    expect(source).toContain("createSelectiveCsrf");
    expect(source).not.toContain('require("csurf")');
    expect(source).not.toContain("csrfProtection(req, res, next)");

    // The file must parse so the API, Docker targets and npm run dev can boot.
    const { execFileSync } = require("child_process");
    execFileSync(process.execPath, ["--check", serverPath], { stdio: "pipe" });
  });
});
