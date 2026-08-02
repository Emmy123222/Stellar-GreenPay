"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../services/email", () => ({
  sendAdminVerificationNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/storage", () => ({
  backendName: () => "local",
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");

function buildApp() {
  const app = express();
  const verification = require("./verification");
  app.use(express.json());
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
  submitted_at: new Date("2026-07-01T00:00:00.000Z").toISOString(),
  reviewed_at: null,
};

describe("POST /api/verification-requests rate limiter", () => {
  let app;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    app = buildApp();
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [MOCK_DB_ROW] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("allows 10 submissions per 15 minutes per IP, blocks the 11th, then resets", async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await request(app)
        .post("/api/verification-requests")
        .send({ ...VALID_PAYLOAD, contactEmail: `submitter${i}@acme.org` });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    }

    const blocked = await request(app)
      .post("/api/verification-requests")
      .send({ ...VALID_PAYLOAD, contactEmail: "blocked@acme.org" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(pool.query).toHaveBeenCalledTimes(10);

    jest.advanceTimersByTime((15 * 60 * 1000) + 1);

    const allowedAfterWindow = await request(app)
      .post("/api/verification-requests")
      .send({ ...VALID_PAYLOAD, contactEmail: "after-window@acme.org" });

    expect(allowedAfterWindow.status).toBe(201);
    expect(allowedAfterWindow.body.success).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(11);
  });
});
