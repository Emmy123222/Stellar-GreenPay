"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../services/redis", () => ({
  get: jest.fn(),
  set: jest.fn(),
  deletePattern: jest.fn(),
}));

jest.mock("../services/stellar", () => ({
  getOnChainProject: jest.fn(),
  getProjectDonationEvents: jest.fn(),
  getRegisteredProjectIdFromTransaction: jest.fn(),
  CONTRACT_ID: "test-contract",
  server: { getTransaction: jest.fn() },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

jest.mock("../services/summaryQueue", () => ({
  enqueueAISummary: jest.fn(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const projectsRouter = require("./projects");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  return app;
}

describe("GET /api/projects/geo", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  const mockRows = [
    {
      id: "8d9ac19b-52eb-42f7-80d9-19a88ba59e43",
      name: "Amazon Reforestation",
      description: "Planting trees in the Amazon",
      category: "Reforestation",
      location: "Brazil",
      wallet_address: "GBRAZIL12345",
      goal_xlm: "10000.0000000",
      raised_xlm: "2500.0000000",
      donor_count: 50,
      co2_offset_kg: 1000,
      status: "active",
      verified: true,
      on_chain_verified: false,
      tags: ["trees"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "7c8ab19a-41da-31e6-70c8-08a77ba48d32",
      name: "Kenya Solar Grid",
      description: "Solar microgrids in Kenya",
      category: "Clean Energy",
      location: "Kenya",
      wallet_address: "GKENYA12345",
      goal_xlm: "50000.0000000",
      raised_xlm: "12000.0000000",
      donor_count: 80,
      co2_offset_kg: 5000,
      status: "active",
      verified: true,
      on_chain_verified: true,
      tags: ["solar"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  test("returns GeoJSON FeatureCollection and project list for all active projects when no bbox is passed", async () => {
    pool.query.mockResolvedValueOnce({ rows: mockRows });

    const res = await request(app).get("/api/projects/geo").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features.length).toBe(2);
    expect(res.body.features[0].geometry.type).toBe("Point");
    expect(res.body.features[0].properties.name).toBe("Amazon Reforestation");
    expect(res.body.features[1].properties.name).toBe("Kenya Solar Grid");
    expect(res.body.data.length).toBe(2);
  });

  test("filters projects within bbox (minLng,minLat,maxLng,maxLat)", async () => {
    pool.query.mockResolvedValueOnce({ rows: mockRows });

    // Kenya is roughly lng: 37, lat: -0.02. Bounding box around East Africa:
    const bbox = "30.0,-5.0,45.0,5.0";
    const res = await request(app)
      .get(`/api/projects/geo?bbox=${bbox}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.features.length).toBe(1);
    expect(res.body.features[0].properties.name).toBe("Kenya Solar Grid");
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("7c8ab19a-41da-31e6-70c8-08a77ba48d32");
  });

  test("returns empty features when bbox does not match any project location", async () => {
    pool.query.mockResolvedValueOnce({ rows: mockRows });

    // Arctic bbox far from Brazil and Kenya:
    const bbox = "-10.0,80.0,10.0,85.0";
    const res = await request(app)
      .get(`/api/projects/geo?bbox=${bbox}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.features.length).toBe(0);
    expect(res.body.data.length).toBe(0);
  });
});
