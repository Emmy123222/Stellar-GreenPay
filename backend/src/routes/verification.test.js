"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("../services/email", () => ({
  sendUpdateNotifications: jest.fn().mockResolvedValue(undefined),
  sendAdminVerificationNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/storage", () => ({
  uploadFile: jest.fn(async (buf, name, type) => ({
    key: "test-key",
    url: "/api/uploads/test-key",
    size: buf.length,
    contentType: type,
    backend: "local",
  })),
  backendName: () => "local",
  UPLOAD_DIR: "/tmp/uploads",
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const { signToken } = require("../middleware/auth");
const verification = require("./verification");
const email = require("../services/email");

function buildApp() {
  const app = express();
  app.use(express.json());
  // Bypass helmet/csrf from server.js for the unit test.
  app.use("/api/verification-requests", verification);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const VALID_PAYLOAD = {
  organizationName: "Acme Climate Foundation",
  organizationWebsite: "https://acme.org",
  organizationCountry: "Kenya",
  contactEmail: "hello@acme.org",
  walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  projectName: "Acme Solar Farm Phase 1",
  projectCategory: "Solar Energy",
  projectLocation: "Nairobi, Kenya",
  projectDescription: "10 MW solar grid supplying rural schools.",
  co2PerXLM: "0.05",
  expectedAnnualTonnesCO2: "1200",
  notes: "Reached out after demo.",
  supportingDocuments: [
    {
      name: "methodology.pdf",
      url: "https://example.com/methodology.pdf",
      size: 1024,
      contentType: "application/pdf",
      backend: "local",
    },
  ],
};

const MOCK_DB_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_name: "Acme Climate Foundation",
  organization_website: "https://acme.org",
  organization_country: "Kenya",
  contact_email: "hello@acme.org",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  project_name: "Acme Solar Farm Phase 1",
  project_category: "Solar Energy",
  project_location: "Nairobi, Kenya",
  project_description: "10 MW solar grid supplying rural schools.",
  co2_per_xlm: "0.0500000",
  expected_annual_tonnes_co2: "1200.0000000",
  supporting_documents: [
    { name: "methodology.pdf", url: "https://example.com/methodology.pdf", size: 1024, backend: "local" },
  ],
  storage_backend: "local",
  notes: "Reached out after demo.",
  status: "pending",
  reviewer_notes: null,
  reviewed_by: null,
  submitted_at: new Date().toISOString(),
  reviewed_at: null,
};

describe("POST /api/verification-requests", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [MOCK_DB_ROW] });
  });

  test("persists a valid submission and returns 201", async () => {
    const res = await request(app).post("/api/verification-requests").send(VALID_PAYLOAD);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(MOCK_DB_ROW.id);
    expect(res.body.data.reviewTimeline).toBe("5–10 business days");

    // Persisted row includes the organizsation + impact fields we sent.
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.startsWith("INSERT INTO verification_requests"),
    );
    expect(insertCall).toBeDefined();
    const values = insertCall[1];
    expect(values).toContain("Acme Climate Foundation");
    expect(values).toContain("hello@acme.org");
    expect(values).toContain("0.0500000");
  });

  test("triggers admin notification asynchronously", async () => {
    await request(app).post("/api/verification-requests").send(VALID_PAYLOAD);
    // Tick the microtask queue so the catch handler attached in the route can run.
    await new Promise((r) => setImmediate(r));
    expect(email.sendAdminVerificationNotification).toHaveBeenCalledTimes(1);
    expect(email.sendAdminVerificationNotification.mock.calls[0][0].organizationName).toBe(
      "Acme Climate Foundation",
    );
  });

  test("rejects missing organization name", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...VALID_PAYLOAD, organizationName: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/organizationName/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("rejects invalid email address", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...VALID_PAYLOAD, contactEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contactEmail/);
  });

  test("rejects malformed Stellar address", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...VALID_PAYLOAD, walletAddress: "not-a-wallet" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/walletAddress/);
  });

  test("rejects project category not in the whitelist", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...VALID_PAYLOAD, projectCategory: "Not a real category" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectCategory/);
  });

  test("rejects negative CO₂ per XLM", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...VALID_PAYLOAD, co2PerXLM: "-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/co2PerXLM/);
  });

  test("rejects document with non-http(s) URL", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({
        ...VALID_PAYLOAD,
        supportingDocuments: [
          { name: "bad.pdf", url: "javascript:alert(1)", size: 100 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/document.url/);
  });
});

describe("GET /api/verification-requests/:id", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns the row when ?wallet matches the stored wallet", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_DB_ROW] });
    const res = await request(app).get(
      `/api/verification-requests/${MOCK_DB_ROW.id}?wallet=${VALID_PAYLOAD.walletAddress}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(MOCK_DB_ROW.id);
  });

  test("forbids access when wallet does not match", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_DB_ROW] });
    const res = await request(app).get(`/api/verification-requests/${MOCK_DB_ROW.id}?wallet=GDIFFERENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`);
    expect(res.status).toBe(403);
  });

  test("returns the row to an admin bearer token without ?wallet", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_DB_ROW] });
    const token = signToken({ role: "admin", sub: "admin" }, "1h");
    const res = await request(app)
      .get(`/api/verification-requests/${MOCK_DB_ROW.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(MOCK_DB_ROW.id);
  });

  test("returns 404 when the row does not exist", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get(
      `/api/verification-requests/missing?wallet=${VALID_PAYLOAD.walletAddress}`,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/verification-requests (admin)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("returns 401 without admin auth", async () => {
    const res = await request(app).get("/api/verification-requests");
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("returns the recent list with admin auth", async () => {
    pool.query.mockResolvedValue({ rows: [MOCK_DB_ROW] });
    const token = signToken({ role: "admin", sub: "admin" }, "1h");
    const res = await request(app)
      .get("/api/verification-requests")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].organizationName).toBe("Acme Climate Foundation");
  });
});

describe("PATCH /api/verification-requests/:id/status (admin)", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  test("transitions pending → in_review", async () => {
    // First DB call: SELECT existing. Second: UPDATE returning new row.
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...MOCK_DB_ROW, status: "pending" }] })
      .mockResolvedValueOnce({ rows: [{ ...MOCK_DB_ROW, status: "in_review" }] });
    const token = signToken({ role: "admin", sub: "admin" }, "1h");
    const res = await request(app)
      .patch(`/api/verification-requests/${MOCK_DB_ROW.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_review" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("in_review");
  });

  test("rejects an invalid transition (pending → approved)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...MOCK_DB_ROW, status: "pending" }] });
    const token = signToken({ role: "admin", sub: "admin" }, "1h");
    const res = await request(app)
      .patch(`/api/verification-requests/${MOCK_DB_ROW.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "approved" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot transition/);
  });

  test("rejects an unknown target status", async () => {
    const token = signToken({ role: "admin", sub: "admin" }, "1h");
    const res = await request(app)
      .patch(`/api/verification-requests/${MOCK_DB_ROW.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "shipped" });
    expect(res.status).toBe(400);
  });
});
