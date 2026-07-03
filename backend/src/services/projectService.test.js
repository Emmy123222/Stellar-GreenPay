/**
 * src/services/projectService.test.js
 */
"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("./store", () => ({
  mapProjectRow: (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    location: row.location,
    walletAddress: row.wallet_address,
    goalXLM: row.goal_xlm,
    raisedXLM: row.raised_xlm,
    donorCount: row.donor_count,
    co2OffsetKg: row.co2_offset_kg,
    status: row.status,
    verified: row.verified,
    onChainVerified: row.on_chain_verified,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }),
}));

const pool = require("../db/pool");
const { getAllProjects, getProjectById, createProject, updateProject } = require("./projectService");

const MOCK_ROW = {
  id: "proj-1",
  name: "Amazon Reforestation",
  description: "Plant trees in Brazil",
  category: "Reforestation",
  location: "Brazil",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  goal_xlm: "10000",
  raised_xlm: "0",
  donor_count: 0,
  co2_offset_kg: 0,
  status: "active",
  verified: false,
  on_chain_verified: false,
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── getAllProjects ──────────────────────────────────────────────────────────

describe("getAllProjects", () => {
  test("returns all projects with default params", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    const result = await getAllProjects();
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Amazon Reforestation");
  });

  test("applies status filter", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    await getAllProjects({ status: "active" });
    const [query, values] = pool.query.mock.calls[0];
    expect(query).toContain("status = $1");
    expect(values).toContain("active");
  });

  test("applies category filter", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    await getAllProjects({ category: "Reforestation" });
    const [query, values] = pool.query.mock.calls[0];
    expect(query).toContain("category = $1");
    expect(values).toContain("Reforestation");
  });

  test("applies both status and category filters", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    await getAllProjects({ status: "active", category: "Solar Energy" });
    const [query, values] = pool.query.mock.calls[0];
    expect(query).toContain("status = $1");
    expect(query).toContain("category = $2");
    expect(values).toContain("active");
    expect(values).toContain("Solar Energy");
  });

  test("ignores invalid status filter", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await getAllProjects({ status: "invalid-status" });
    const [query] = pool.query.mock.calls[0];
    expect(query).not.toContain("status =");
  });

  test("ignores invalid category filter", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await getAllProjects({ category: "Unicorn Farming" });
    const [query] = pool.query.mock.calls[0];
    expect(query).not.toContain("category =");
  });

  test("caps limit at 100", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await getAllProjects({ limit: 9999 });
    const [, values] = pool.query.mock.calls[0];
    expect(values[values.length - 1]).toBe(100);
  });

  test("returns empty array when no projects found", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getAllProjects();
    expect(result).toEqual([]);
  });
});

// ─── getProjectById ──────────────────────────────────────────────────────────

describe("getProjectById", () => {
  test("returns project when found", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    const result = await getProjectById("proj-1");
    expect(pool.query).toHaveBeenCalledWith(
      "SELECT * FROM projects WHERE id = $1",
      ["proj-1"],
    );
    expect(result).not.toBeNull();
    expect(result.id).toBe("proj-1");
  });

  test("returns null when project not found", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getProjectById("nonexistent");
    expect(result).toBeNull();
  });

  test("maps row fields to camelCase", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    const result = await getProjectById("proj-1");
    expect(result).toHaveProperty("walletAddress");
    expect(result).toHaveProperty("raisedXLM");
    expect(result).toHaveProperty("donorCount");
    expect(result).not.toHaveProperty("wallet_address");
  });
});

// ─── createProject ───────────────────────────────────────────────────────────

describe("createProject", () => {
  test("creates a project with valid inputs", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    const result = await createProject({
      id: "proj-1",
      name: "Amazon Reforestation",
      description: "Plant trees",
      category: "Reforestation",
      location: "Brazil",
      walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      goalXLM: "10000",
      co2PerXLM: 50,
    });
    expect(result).not.toBeNull();
    expect(result.name).toBe("Amazon Reforestation");
  });

  test("throws when name is missing", async () => {
    await expect(
      createProject({ category: "Reforestation", walletAddress: "G..." }),
    ).rejects.toThrow("name, category, and walletAddress are required");
  });

  test("throws when category is missing", async () => {
    await expect(
      createProject({ name: "Test", walletAddress: "G..." }),
    ).rejects.toThrow("name, category, and walletAddress are required");
  });

  test("throws when walletAddress is missing", async () => {
    await expect(
      createProject({ name: "Test", category: "Reforestation" }),
    ).rejects.toThrow("name, category, and walletAddress are required");
  });

  test("throws on invalid category", async () => {
    await expect(
      createProject({ name: "Test", category: "Unicorn Farming", walletAddress: "G..." }),
    ).rejects.toThrow("Invalid category");
  });

  test("uses default description and location when omitted", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROW] });
    await createProject({ id: "p1", name: "Test", category: "Reforestation", walletAddress: "G..." });
    const [, values] = pool.query.mock.calls[0];
    expect(values[2]).toBe("");
    expect(values[4]).toBe("");
  });
});

// ─── updateProject ───────────────────────────────────────────────────────────

describe("updateProject", () => {
  test("updates status of an existing project", async () => {
    const updated = { ...MOCK_ROW, status: "paused" };
    pool.query.mockResolvedValueOnce({ rows: [updated] });
    const result = await updateProject("proj-1", { status: "paused" });
    expect(result).not.toBeNull();
    expect(result.status).toBe("paused");
  });

  test("updates verified field", async () => {
    const updated = { ...MOCK_ROW, verified: true };
    pool.query.mockResolvedValueOnce({ rows: [updated] });
    const result = await updateProject("proj-1", { verified: true });
    expect(result).not.toBeNull();
    expect(result.verified).toBe(true);
  });

  test("updates both status and verified", async () => {
    const updated = { ...MOCK_ROW, status: "completed", verified: true };
    pool.query.mockResolvedValueOnce({ rows: [updated] });
    const result = await updateProject("proj-1", { status: "completed", verified: true });
    const [query] = pool.query.mock.calls[0];
    expect(query).toContain("status = $1");
    expect(query).toContain("verified = $2");
    expect(result.status).toBe("completed");
  });

  test("throws on invalid status", async () => {
    await expect(updateProject("proj-1", { status: "archived" })).rejects.toThrow("Invalid status");
  });

  test("throws when no valid fields provided", async () => {
    await expect(updateProject("proj-1", {})).rejects.toThrow("No valid fields to update");
  });

  test("returns null when project not found", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await updateProject("nonexistent", { status: "paused" });
    expect(result).toBeNull();
  });
});
