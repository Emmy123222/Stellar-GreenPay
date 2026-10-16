"use strict";
/**
 * GET/PUT /api/projects/:id/preferred-asset (#1660)
 */

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/redis", () => ({ deletePattern: jest.fn(async () => {}) }));

process.env.ADMIN_API_KEY = "test-admin-key";

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const redis = require("../services/redis");
const { signToken } = require("../middleware/auth");
const router = require("./projectPreferredAsset");

const OWNER = `G${"O".repeat(55)}`;
const STRANGER = `G${"S".repeat(55)}`;
const ISSUER = `G${"I".repeat(55)}`;
const URL = "/api/projects/proj-1/preferred-asset";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/projects/:id/preferred-asset", router);
  return a;
}

const wallet = (addr) => `Bearer ${signToken({ sub: addr, type: "wallet" }, "1h")}`;

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockReset();
});

it("GET returns null for XLM projects", async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ preferred_asset_code: null, preferred_asset_issuer: null }] });
  const res = await request(app()).get(URL).expect(200);
  expect(res.body.data).toEqual({ preferredAsset: null });
});

it("GET 404s for unknown projects", async () => {
  pool.query.mockResolvedValueOnce({ rows: [] });
  await request(app()).get(URL).expect(404);
});

it("lets the project owner set USDC", async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ wallet_address: OWNER }] })
    .mockResolvedValueOnce({ rows: [{ preferred_asset_code: "USDC", preferred_asset_issuer: ISSUER }] });

  const res = await request(app())
    .put(URL)
    .set("Authorization", wallet(OWNER))
    .send({ preferredAsset: { code: "USDC", issuer: ISSUER } })
    .expect(200);

  expect(res.body.data.preferredAsset).toEqual({ code: "USDC", issuer: ISSUER });
  expect(pool.query.mock.calls[1][1]).toEqual(["USDC", ISSUER, "proj-1"]);
  expect(redis.deletePattern).toHaveBeenCalledWith("projects:detail:proj-1*");
});

it("lets an admin clear it back to XLM", async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ wallet_address: OWNER }] })
    .mockResolvedValueOnce({ rows: [{ preferred_asset_code: null, preferred_asset_issuer: null }] });

  await request(app()).put(URL).set("X-Admin-Key", "test-admin-key").send({ preferredAsset: null }).expect(200);
  expect(pool.query.mock.calls[1][1]).toEqual([null, null, "proj-1"]);
});

it("forbids other wallets", async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ wallet_address: OWNER }] });
  await request(app())
    .put(URL)
    .set("Authorization", wallet(STRANGER))
    .send({ preferredAsset: { code: "USDC", issuer: ISSUER } })
    .expect(403);
  expect(pool.query).toHaveBeenCalledTimes(1);
});

it("requires authentication", async () => {
  await request(app()).put(URL).send({ preferredAsset: null }).expect(401);
});

it("validates the asset before touching the database", async () => {
  await request(app())
    .put(URL)
    .set("Authorization", wallet(OWNER))
    .send({ preferredAsset: { code: "USDC", issuer: "bad" } })
    .expect(400);
  expect(pool.query).not.toHaveBeenCalled();
});
