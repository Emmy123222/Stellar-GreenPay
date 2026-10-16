"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const referralsRouter = require("./referrals");

const REFERRER = `G${"A".repeat(55)}`;
const REFERRED = `G${"B".repeat(55)}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/referrals", referralsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

function queryResult(rows = []) {
  return { rows };
}

function createMockClient(...responses) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  responses.forEach((response) => client.query.mockResolvedValueOnce(response));
  pool.connect.mockResolvedValue(client);
  return client;
}

describe("referral routes", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  describe("POST /api/referrals", () => {
    it("creates a referral for valid wallet addresses", async () => {
      const referral = {
        id: "referral-1",
        referrer_address: REFERRER,
        referred_address: REFERRED,
        bonus_awarded: false,
      };
      const client = createMockClient(
        queryResult(),
        queryResult([referral]),
        queryResult(),
      );

      const res = await request(app)
        .post("/api/referrals")
        .send({ referrerAddress: REFERRER, referredAddress: REFERRED })
        .expect(200);

      expect(res.body).toEqual({ success: true, data: referral });
      expect(client.query).toHaveBeenCalledTimes(3);
      expect(client.query.mock.calls[1][0]).toContain("INSERT INTO referrals");
      expect(client.query.mock.calls[2]).toEqual([
        expect.stringContaining("UPDATE profiles"),
        [REFERRER, REFERRED],
      ]);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it("rejects a duplicate claim with 409 and does not insert it again", async () => {
      const client = createMockClient(queryResult([{ id: "referral-existing" }]));

      const res = await request(app)
        .post("/api/referrals")
        .send({ referrerAddress: REFERRER, referredAddress: REFERRED })
        .expect(409);

      expect(res.body.error).toMatch(/already claimed/i);
      expect(client.query).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it("rejects an insert lost to a concurrent duplicate claim", async () => {
      const client = createMockClient(queryResult(), queryResult());

      const res = await request(app)
        .post("/api/referrals")
        .send({ referrerAddress: REFERRER, referredAddress: REFERRED })
        .expect(409);

      expect(res.body.error).toMatch(/already claimed/i);
      expect(client.query.mock.calls[1][0]).toContain("ON CONFLICT");
      expect(client.query).toHaveBeenCalledTimes(2);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid wallet address through Zod before accessing the database", async () => {
      const res = await request(app)
        .post("/api/referrals")
        .send({ referrerAddress: "invalid-wallet", referredAddress: REFERRED })
        .expect(400);

      expect(res.body.error).toBe("Invalid referrer address");
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it("rejects self-referrals", async () => {
      const res = await request(app)
        .post("/api/referrals")
        .send({ referrerAddress: REFERRER, referredAddress: REFERRER })
        .expect(400);

      expect(res.body.error).toBe("Cannot refer yourself");
      expect(pool.connect).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/referrals/:publicKey", () => {
    it("returns the referral stats read by the referral section", async () => {
      pool.query.mockResolvedValue(queryResult([{
        referral_count: 3,
        referral_bonus_xlm: "15.0000000",
        referred_by: REFERRER,
      }]));

      const res = await request(app).get(`/api/referrals/${REFERRED}`).expect(200);

      expect(res.body).toEqual({
        success: true,
        data: {
          referralCount: 3,
          referralBonusXLM: "15.0000000",
          referredBy: REFERRER,
        },
      });
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("FROM profiles"), [REFERRED]);
    });

    it("returns zeroed stats when the wallet has no profile", async () => {
      pool.query.mockResolvedValue(queryResult());

      const res = await request(app).get(`/api/referrals/${REFERRED}`).expect(200);

      expect(res.body.data).toEqual({
        referralCount: 0,
        referralBonusXLM: "0",
        referredBy: null,
      });
    });

    it("rejects an invalid wallet address before querying the database", async () => {
      const res = await request(app).get("/api/referrals/not-a-wallet").expect(400);

      expect(res.body.error).toBe("Invalid Stellar public key");
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/referrals/award-bonus", () => {
    it("awards the referral bonus after the referred wallet's first donation", async () => {
      const client = createMockClient(
        queryResult(),
        queryResult([{ id: "referral-1", referrer_address: REFERRER, bonus_awarded: false }]),
        queryResult(),
        queryResult(),
        queryResult(),
      );

      const res = await request(app)
        .post("/api/referrals/award-bonus")
        .send({ referredAddress: REFERRED, donationId: "donation-1" })
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        data: { awarded: true, bonusXLM: "5", referrerAddress: REFERRER },
      });
      expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
        "BEGIN",
        expect.stringContaining("SELECT id, referrer_address, bonus_awarded"),
        expect.stringContaining("UPDATE referrals"),
        expect.stringContaining("UPDATE profiles"),
        "COMMIT",
      ]);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it("does not award a bonus when there is no pending referral", async () => {
      const client = createMockClient(queryResult(), queryResult(), queryResult());

      const res = await request(app)
        .post("/api/referrals/award-bonus")
        .send({ referredAddress: REFERRED, donationId: "donation-1" })
        .expect(200);

      expect(res.body.data).toEqual({ awarded: false, reason: "No pending referral" });
      expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
        "BEGIN",
        expect.stringContaining("SELECT id, referrer_address, bonus_awarded"),
        "ROLLBACK",
      ]);
      expect(client.release).toHaveBeenCalledTimes(1);
    });
  });
});
