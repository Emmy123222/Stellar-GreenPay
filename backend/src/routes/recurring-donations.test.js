"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

const express = require("express");
const request = require("supertest");
const recurringDonationsRouter = require("./recurring-donations");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/recurring-donations", recurringDonationsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}

describe("POST /api/recurring-donations", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  test("creates a recurring donation with valid amount >= 1 XLM", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("A"),
        amountXLM: "10",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.amountXLM).toBe("10.0000000");
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.projectId).toBe("project-1");
  });

  test("creates a recurring donation with exactly 1 XLM", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("B"),
        amountXLM: "1",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.amountXLM).toBe("1.0000000");
  });

  test("creates a recurring donation with amount > 1 XLM", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("C"),
        amountXLM: "25.5",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.amountXLM).toBe("25.5000000");
  });

  test("rejects amount of 0", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("D"),
        amountXLM: "0",
      })
      .expect(400);

    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
  });

  test("rejects amount below 1 XLM", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("E"),
        amountXLM: "0.5",
      })
      .expect(400);

    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
  });

  test("rejects negative amount", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("F"),
        amountXLM: "-5",
      })
      .expect(400);

    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
  });

  test("rejects non-numeric amount", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("G"),
        amountXLM: "abc",
      })
      .expect(400);

    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
  });

  test("rejects empty amount", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("H"),
        amountXLM: "",
      })
      .expect(400);

    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
  });

  test("rejects missing projectId", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        donorAddress: makePublicKey("I"),
        amountXLM: "10",
      })
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
  });

  test("rejects missing donorAddress", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        amountXLM: "10",
      })
      .expect(422);

    expect(res.body.error).toBe("Validation failed");
  });

  test("rejects invalid Stellar public key", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: "not-a-key",
        amountXLM: "10",
      })
      .expect(400);

    expect(res.body.error).toBe("Invalid Stellar public key");
  });

  test("accepts amount as number", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("J"),
        amountXLM: 15,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.amountXLM).toBe("15.0000000");
  });

  test("rejects amount just below 1", async () => {
    const res = await request(app)
      .post("/api/recurring-donations")
      .send({
        projectId: "project-1",
        donorAddress: makePublicKey("K"),
        amountXLM: "0.9999999",
      })
      .expect(400);

    expect(res.body.error).toContain("Minimum recurring donation is 1 XLM");
  });
});
