"use strict";

/**
 * Tests for #795 — prevent org email spoofing in verification submissions.
 *
 * The contactEmail domain must match (or be a subdomain of) the
 * organizationWebsite domain when a website is provided.
 */

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req, _res, next) => next(),
}));
jest.mock("../services/email", () => ({
  sendAdminVerificationNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/storage", () => ({
  uploadFile: jest.fn(),
  backendName: () => "local",
  UPLOAD_DIR: "/tmp/uploads",
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const verification = require("./verification");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/verification-requests", verification);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

const BASE = {
  organizationName: "Acme Climate Foundation",
  organizationWebsite: "https://acme.org",
  organizationCountry: "Kenya",
  contactEmail: "hello@acme.org",
  walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  projectName: "Acme Solar Farm Phase 1",
  projectCategory: "Solar Energy",
  projectLocation: "Nairobi, Kenya",
  co2PerXLM: "0.05",
};

const MOCK_DB_ROW = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  organization_name: "Acme Climate Foundation",
  organization_website: "https://acme.org",
  organization_country: "Kenya",
  contact_email: "hello@acme.org",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  project_name: "Acme Solar Farm Phase 1",
  project_category: "Solar Energy",
  project_location: "Nairobi, Kenya",
  project_description: null,
  co2_per_xlm: "0.0500000",
  expected_annual_tonnes_co2: null,
  supporting_documents: [],
  storage_backend: "local",
  notes: null,
  status: "pending",
  reviewer_notes: null,
  reviewed_by: null,
  submitted_at: new Date().toISOString(),
  reviewed_at: null,
};

describe("verification submission — email domain validation (#795)", () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [MOCK_DB_ROW] });
  });

  test("accepts submission when email domain matches website domain", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...BASE, contactEmail: "hello@acme.org" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test("accepts submission when email is a subdomain of website", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...BASE, contactEmail: "team@mail.acme.org" });
    expect(res.status).toBe(201);
  });

  test("accepts www-prefixed website matched against plain domain email", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...BASE, organizationWebsite: "https://www.acme.org", contactEmail: "ceo@acme.org" });
    expect(res.status).toBe(201);
  });

  test("rejects submission when email domain does not match website", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...BASE, contactEmail: "spoofer@gmail.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contactEmail domain.*gmail\.com.*must match.*acme\.org/i);
  });

  test("rejects submission with email from similar-sounding domain", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...BASE, contactEmail: "fake@acme.org.evil.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contactEmail domain/i);
  });

  test("allows any valid email when organizationWebsite is omitted", async () => {
    const { organizationWebsite: _, ...noWebsite } = BASE;
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...noWebsite, contactEmail: "anyone@gmail.com" });
    expect(res.status).toBe(201);
  });

  test("allows any valid email when organizationWebsite is empty string", async () => {
    const res = await request(app)
      .post("/api/verification-requests")
      .send({ ...BASE, organizationWebsite: "", contactEmail: "anyone@gmail.com" });
    expect(res.status).toBe(201);
  });
});
