"use strict";
/**
 * tests for src/routes/updates.js
 *
 * Covers:
 *  - GET  /api/updates/:projectId   — cursor pagination + imageUrl in response
 *  - POST /api/updates              — create update, with and without image_url
 *  - POST /api/updates/:id/like     — toggle like
 *  - GET  /api/updates/:id/likes    — like count / status
 */

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../services/email", () => ({
  sendUpdateNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/push", () => ({
  sendUpdatePushNotifications: jest.fn().mockResolvedValue(undefined),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const updatesRouter = require("./updates");

process.env.ADMIN_API_KEY = "test-admin-key";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/updates", updatesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  });
  return app;
}

// ── Shared fixtures ──────────────────────────────────────────────────────────

const MOCK_PROJECT_ROW = {
  id: "proj-1",
  name: "Test Project",
  description: "desc",
  category: "Reforestation",
  location: "Brazil",
  wallet_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  goal_xlm: "10000",
  raised_xlm: "5000",
  donor_count: 42,
  co2_offset_kg: 50000,
  status: "active",
  verified: true,
  on_chain_verified: false,
  tags: ["reforestation"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const MOCK_UPDATE_ROW = {
  id: "upd-1",
  project_id: "proj-1",
  title: "We planted 500 trees",
  body: "Great progress this month.",
  image_url: null,
  created_at: new Date().toISOString(),
};

const MOCK_UPDATE_ROW_WITH_IMAGE = {
  ...MOCK_UPDATE_ROW,
  id: "upd-2",
  image_url: "https://cdn.example.com/photo.jpg",
};

// ── GET /api/updates/:projectId ───────────────────────────────────────────────

describe("GET /api/updates/:projectId", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test("returns empty list when no updates exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/api/updates/proj-1").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
  });

  test("returns updates with imageUrl field (null when absent)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_UPDATE_ROW] });

    const res = await request(app).get("/api/updates/proj-1").expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: "upd-1",
      projectId: "proj-1",
      title: "We planted 500 trees",
      body: "Great progress this month.",
      imageUrl: null,
    });
  });

  test("returns updates with imageUrl populated when present", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_UPDATE_ROW_WITH_IMAGE] });

    const res = await request(app).get("/api/updates/proj-1").expect(200);

    expect(res.body.data[0].imageUrl).toBe("https://cdn.example.com/photo.jpg");
  });

  test("paginates correctly — has_more true when extra row exists", async () => {
    // Return pageSize + 1 rows (default limit 10 → return 11)
    const rows = Array.from({ length: 11 }, (_, i) => ({
      ...MOCK_UPDATE_ROW,
      id: `upd-${i}`,
    }));
    pool.query.mockResolvedValueOnce({ rows });

    const res = await request(app).get("/api/updates/proj-1?limit=10").expect(200);

    expect(res.body.has_more).toBe(true);
    expect(res.body.next_cursor).not.toBeNull();
    expect(res.body.data).toHaveLength(10);
  });

  test("returns 400 for an invalid cursor", async () => {
    const res = await request(app)
      .get("/api/updates/proj-1?cursor=!!!notbase64!!!")
      .expect(400);
    expect(res.body.error).toMatch(/cursor/i);
  });
});

// ── POST /api/updates ─────────────────────────────────────────────────────────

describe("POST /api/updates", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    // Default: pool.query returns an empty rows array unless overridden per-test.
    pool.query.mockResolvedValue({ rows: [] });
  });

  function adminPost(body) {
    return request(app)
      .post("/api/updates")
      .set("X-Admin-Key", "test-admin-key")
      .send(body);
  }

  test("returns 401 without admin credentials", async () => {
    const res = await request(app)
      .post("/api/updates")
      .send({ projectId: "proj-1", title: "T", body: "B" });
    expect(res.status).toBe(401);
  });

  test("returns 400 when projectId is missing", async () => {
    const res = await adminPost({ title: "T", body: "B" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  test("returns 400 when title is missing", async () => {
    const res = await adminPost({ projectId: "proj-1", body: "B" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  test("returns 400 when body is missing", async () => {
    const res = await adminPost({ projectId: "proj-1", title: "T" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/body/i);
  });

  test("returns 404 when project does not exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // project lookup
    const res = await adminPost({ projectId: "proj-999", title: "T", body: "B" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/project not found/i);
  });

  test("creates update without image_url and returns imageUrl: null", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] })   // SELECT project
      .mockResolvedValueOnce({ rows: [MOCK_UPDATE_ROW] })     // INSERT update
      .mockResolvedValue({ rows: [] });                        // subscription/push queries

    const res = await adminPost({ projectId: "proj-1", title: "T", body: "B" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.imageUrl).toBeNull();

    // Verify INSERT includes $5 (image_url)
    const insertCall = pool.query.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO project_updates"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toHaveLength(5);
    expect(insertCall[1][4]).toBeNull(); // image_url value
  });

  test("creates update with a valid image_url and returns it in response", async () => {
    const imageUrl = "https://cdn.example.com/update-photo.jpg";
    const rowWithImage = { ...MOCK_UPDATE_ROW, image_url: imageUrl };

    pool.query
      .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] })
      .mockResolvedValueOnce({ rows: [rowWithImage] })
      .mockResolvedValue({ rows: [] });

    const res = await adminPost({
      projectId: "proj-1",
      title: "New milestone photo",
      body: "We hit 10k trees!",
      image_url: imageUrl,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toBe(imageUrl);

    const insertCall = pool.query.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO project_updates"),
    );
    expect(insertCall[1][4]).toBe(imageUrl);
  });

  test("returns 400 when image_url is provided but not a valid URL", async () => {
    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: "not-a-url",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  test("returns 400 when image_url uses a non-http scheme", async () => {
    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: "ftp://files.example.com/image.jpg",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/http/i);
  });

  test("accepts http:// image_url in addition to https://", async () => {
    const imageUrl = "http://cdn.example.com/photo.png";
    const rowWithImage = { ...MOCK_UPDATE_ROW, image_url: imageUrl };

    pool.query
      .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] })
      .mockResolvedValueOnce({ rows: [rowWithImage] })
      .mockResolvedValue({ rows: [] });

    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: imageUrl,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toBe(imageUrl);
  });

  test("treats null image_url the same as omitted", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MOCK_PROJECT_ROW] })
      .mockResolvedValueOnce({ rows: [MOCK_UPDATE_ROW] })
      .mockResolvedValue({ rows: [] });

    const res = await adminPost({
      projectId: "proj-1",
      title: "T",
      body: "B",
      image_url: null,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toBeNull();

    const insertCall = pool.query.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO project_updates"),
    );
    expect(insertCall[1][4]).toBeNull();
  });
});

// ── POST /api/updates/:updateId/like ─────────────────────────────────────────

describe("POST /api/updates/:updateId/like", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test("returns 400 when donorAddress is missing", async () => {
    const res = await request(app).post("/api/updates/upd-1/like").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/donorAddress/i);
  });

  test("returns 404 when update does not exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // update lookup
    const res = await request(app)
      .post("/api/updates/upd-999/like")
      .send({ donorAddress: "GABC" });
    expect(res.status).toBe(404);
  });

  test("toggles like on and returns liked: true", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "upd-1" }] })  // update exists
      .mockResolvedValueOnce({ rows: [] })                  // not yet liked
      .mockResolvedValueOnce({ rows: [] })                  // INSERT like
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });   // count

    const res = await request(app)
      .post("/api/updates/upd-1/like")
      .send({ donorAddress: "GABC" });

    expect(res.status).toBe(200);
    expect(res.body.data.liked).toBe(true);
    expect(res.body.data.likeCount).toBe(1);
  });

  test("toggles like off and returns liked: false", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "upd-1" }] })  // update exists
      .mockResolvedValueOnce({ rows: [{ id: "like-1" }] }) // already liked
      .mockResolvedValueOnce({ rows: [] })                  // DELETE like
      .mockResolvedValueOnce({ rows: [{ count: "0" }] });   // count

    const res = await request(app)
      .post("/api/updates/upd-1/like")
      .send({ donorAddress: "GABC" });

    expect(res.status).toBe(200);
    expect(res.body.data.liked).toBe(false);
    expect(res.body.data.likeCount).toBe(0);
  });
});

// ── GET /api/updates/:updateId/likes ─────────────────────────────────────────

describe("GET /api/updates/:updateId/likes", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test("returns likeCount and liked: false when donorAddress is not provided", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: "5" }] });

    const res = await request(app).get("/api/updates/upd-1/likes").expect(200);

    expect(res.body.data.likeCount).toBe(5);
    expect(res.body.data.liked).toBe(false);
  });

  test("returns liked: true when the donor has liked the update", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ id: "like-1" }] });

    const res = await request(app)
      .get("/api/updates/upd-1/likes?donorAddress=GABC")
      .expect(200);

    expect(res.body.data.likeCount).toBe(3);
    expect(res.body.data.liked).toBe(true);
  });

  test("returns liked: false when the donor has not liked the update", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/updates/upd-1/likes?donorAddress=GXYZ")
      .expect(200);

    expect(res.body.data.liked).toBe(false);
  });
});
