"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

const http = require("http");
const express = require("express");
const supertest = require("supertest");
const pool = require("../db/pool");
const donationEvents = require("../services/donationEvents");

function makePublicKey(char = "A") {
  return `G${char.repeat(55)}`;
}

function makeTxHash(char = "a") {
  return char.repeat(64);
}

function queryResult(rows = []) {
  return { rows };
}

function createMockClient(...responses) {
  const client = { query: jest.fn(), release: jest.fn() };
  responses.forEach((r) => {
    if (r instanceof Error) {
      client.query.mockRejectedValueOnce(r);
    } else {
      client.query.mockResolvedValueOnce(r);
    }
  });
  pool.connect.mockResolvedValue(client);
  return client;
}

describe("GET /api/donations/stream", () => {
  let httpServer;
  let baseUrl;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    httpServer = http.createServer(app);
    app.use("/api/donations", require("./donations"));
    httpServer.listen(0, () => {
      baseUrl = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    donationEvents.removeAllListeners();
    httpServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    donationEvents.removeAllListeners();
  });

  test("returns correct SSE headers", (done) => {
    const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.headers["connection"]).toBe("keep-alive");
      expect(res.headers["x-accel-buffering"]).toBe("no");
      res.destroy();
      done();
    });
    req.on("error", done);
  });

  test("receives a donation event with projectName, amountXLM, and donorBadge", (done) => {
    const chunks = [];

    const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
      res.on("data", (chunk) => {
        const text = chunk.toString();
        chunks.push(text);

        const fullText = chunks.join("");
        if (fullText.includes("data:")) {
          const match = fullText.match(/data: ({.*})\n\n/);
          if (match) {
            const payload = JSON.parse(match[1]);
            try {
              expect(payload).toHaveProperty("projectName");
              expect(payload).toHaveProperty("amountXLM");
              expect(payload).toHaveProperty("donorBadge");
              expect(typeof payload.projectName).toBe("string");
              expect(typeof payload.amountXLM).toBe("string");
              res.destroy();
              done();
            } catch (err) {
              res.destroy();
              done(err);
            }
          }
        }
      });
    });

    req.on("error", done);

    // Give the connection time to establish, then emit an event
    setTimeout(() => {
      donationEvents.emit("new_donation", {
        projectName: "Amazon Reforestation",
        amountXLM: "25.0",
        donorBadge: "Seedling",
      });
    }, 50);
  });

  test("emits correctly formatted SSE data line", (done) => {
    const chunks = [];

    const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
      res.on("data", (chunk) => {
        chunks.push(chunk.toString());
        const fullText = chunks.join("");
        if (fullText.includes("data:")) {
          try {
            expect(fullText).toMatch(/data: \{.*\}\n\n/);
            res.destroy();
            done();
          } catch (err) {
            res.destroy();
            done(err);
          }
        }
      });
    });

    req.on("error", done);

    setTimeout(() => {
      donationEvents.emit("new_donation", {
        projectName: "Ocean Cleanup",
        amountXLM: "100.0",
        donorBadge: "Tree",
      });
    }, 50);
  });

  test("receives multiple events in sequence", (done) => {
    const events = [];
    const expectedCount = 3;

    const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
      res.on("data", (chunk) => {
        const text = chunk.toString();
        const match = text.match(/data: ({.*})\n\n/);
        if (match) {
          events.push(JSON.parse(match[1]));
          if (events.length === expectedCount) {
            try {
              expect(events[0].projectName).toBe("Project A");
              expect(events[1].projectName).toBe("Project B");
              expect(events[2].projectName).toBe("Project C");
              expect(events[2].amountXLM).toBe("50.0");
              res.destroy();
              done();
            } catch (err) {
              res.destroy();
              done(err);
            }
          }
        }
      });
    });

    req.on("error", done);

    setTimeout(() => {
      donationEvents.emit("new_donation", { projectName: "Project A", amountXLM: "10.0", donorBadge: "Seedling" });
      donationEvents.emit("new_donation", { projectName: "Project B", amountXLM: "20.0", donorBadge: "Tree" });
      donationEvents.emit("new_donation", { projectName: "Project C", amountXLM: "50.0", donorBadge: "Forest" });
    }, 50);
  });

  test("cleans up listener on client disconnect", (done) => {
    const req = http.get(`${baseUrl}/api/donations/stream`, (res) => {
      const listenerCountBefore = donationEvents.listenerCount("new_donation");
      expect(listenerCountBefore).toBeGreaterThanOrEqual(1);

      res.destroy();

      // Allow time for the close event to propagate
      setTimeout(() => {
        const listenerCountAfter = donationEvents.listenerCount("new_donation");
        expect(listenerCountAfter).toBeLessThan(listenerCountBefore);
        done();
      }, 100);
    });

    req.on("error", done);
  });
});

describe("POST /api/donations → SSE emission", () => {
  let httpServer;
  let request;
  let baseUrl;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    httpServer = http.createServer(app);
    app.use("/api/donations", require("./donations"));
    httpServer.listen(0, () => {
      baseUrl = `http://localhost:${httpServer.address().port}`;
      request = supertest(httpServer);
      done();
    });
  });

  afterAll((done) => {
    donationEvents.removeAllListeners();
    httpServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    donationEvents.removeAllListeners();
  });

  test(
    "POST /api/donations emits enriched SSE event with projectName and donorBadge",
    (done) => {
      const donorAddress = makePublicKey("W");
      const transactionHash = makeTxHash("7");
      const donationRow = {
        id: "sse-donation-1",
        project_id: "project-sse",
        donor_address: donorAddress,
        amount_xlm: "25",
        amount: "25",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      };

      createMockClient(
        queryResult([{ id: "project-sse", name: "Amazon Reforestation" }]), // SELECT project
        queryResult([]),                          // dedup check
        queryResult(),                            // BEGIN
        queryResult([donationRow]),               // INSERT donation
        queryResult([]),                          // SELECT donation_matches (empty)
        queryResult(),                            // UPDATE projects
        queryResult([{ total_donated_xlm: "25" }]), // SELECT profile (badge = Seedling)
        queryResult([{ count: "1" }]),            // COUNT(DISTINCT project_id)
        queryResult(),                            // INSERT profile
        queryResult(),                            // COMMIT
      );

      const deadline = setTimeout(() => {
        done(new Error("SSE event was not received within 500 ms"));
      }, 500);

      donationEvents.on("new_donation", (data) => {
        clearTimeout(deadline);
        try {
          expect(data.projectName).toBe("Amazon Reforestation");
          expect(data.amountXLM).toBe("25");
          expect(data.donorBadge).toBe("Seedling");
          done();
        } catch (err) {
          done(err);
        }
      });

      request
        .post("/api/donations")
        .send({
          projectId: "project-sse",
          donorAddress,
          amountXLM: "25",
          transactionHash,
        })
        .end((err) => {
          if (err) {
            clearTimeout(deadline);
            done(err);
          }
        });
    },
    2000,
  );

  test(
    "SSE event for large donation emits correct badge tier",
    (done) => {
      const donorAddress = makePublicKey("V");
      const transactionHash = makeTxHash("a");
      const donationRow = {
        id: "sse-donation-2",
        project_id: "project-big",
        donor_address: donorAddress,
        amount_xlm: "500",
        amount: "500",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      };

      createMockClient(
        queryResult([{ id: "project-big", name: "Amazon Reforestation" }]),
        queryResult([]),
        queryResult(),
        queryResult([donationRow]),
        queryResult([]),
        queryResult(),
        queryResult([{ total_donated_xlm: "500" }]), // Forest badge
        queryResult([{ count: "1" }]),
        queryResult(),
        queryResult(),
      );

      const deadline = setTimeout(() => {
        done(new Error("SSE event was not received within 500 ms"));
      }, 500);

      donationEvents.on("new_donation", (data) => {
        clearTimeout(deadline);
        try {
          expect(data.projectName).toBe("Amazon Reforestation");
          expect(data.amountXLM).toBe("500");
          expect(data.donorBadge).toBe("Forest");
          done();
        } catch (err) {
          done(err);
        }
      });

      request
        .post("/api/donations")
        .send({
          projectId: "project-big",
          donorAddress,
          amountXLM: "500",
          transactionHash,
        })
        .end((err) => {
          if (err) {
            clearTimeout(deadline);
            done(err);
          }
        });
    },
    2000,
  );
});
