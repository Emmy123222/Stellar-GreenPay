"use strict";

jest.mock("../db/pool", () => ({ connect: jest.fn() }));
jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../services/stellar", () => ({
  server: { getTransaction: jest.fn().mockResolvedValue({ successful: true }) },
}));

const http = require("http");
const express = require("express");
const { Server: SocketServer } = require("socket.io");
const { io: ioc } = require("socket.io-client");
const supertest = require("supertest");
const pool = require("../db/pool");

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

describe("POST /api/donations → donation_event WebSocket broadcast", () => {
  let httpServer;
  let ioServer;
  let request;
  let baseUrl;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    httpServer = http.createServer(app);
    ioServer = new SocketServer(httpServer, {
      cors: { origin: "*" },
      transports: ["websocket"],
    });
    app.set("io", ioServer);
    app.use("/api/donations", require("./donations"));

    httpServer.listen(0, () => {
      const { port } = httpServer.address();
      baseUrl = `http://localhost:${port}`;
      request = supertest(httpServer);
      done();
    });
  });

  afterAll((done) => {
    ioServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test(
    "emits donation_event to connected clients within 500 ms",
    (done) => {
      const donorAddress = makePublicKey("W");
      const transactionHash = makeTxHash("7");
      const donationRow = {
        id: "socket-donation-1",
        project_id: "project-ws",
        donor_address: donorAddress,
        amount_xlm: "25",
        amount: "25",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      };

      createMockClient(
        queryResult([{ id: "project-ws" }]),   // SELECT project
        queryResult([]),                          // dedup check
        queryResult(),                            // BEGIN
        queryResult([donationRow]),               // INSERT donation
        queryResult([]),                          // SELECT donation_matches (empty)
        queryResult(),                            // UPDATE projects
        queryResult([]),                          // SELECT * FROM profiles (new donor)
        queryResult([{ count: "1" }]),            // SELECT COUNT(DISTINCT project_id)
        queryResult(),                            // INSERT INTO profiles
      );

      const socket = ioc(baseUrl, {
        transports: ["websocket"],
        forceNew: true,
      });

      const deadline = setTimeout(() => {
        socket.disconnect();
        done(new Error("donation_event was not received within 500 ms"));
      }, 500);

      socket.on("connect", () => {
        socket.on("donation_event", (data) => {
          clearTimeout(deadline);
          socket.disconnect();
          try {
            expect(data.projectId).toBe("project-ws");
            expect(data.donorAddress).toBe(donorAddress);
            expect(data.transactionHash).toBe(transactionHash);
            expect(typeof data.timestamp).toBe("string");
            done();
          } catch (assertionError) {
            done(assertionError);
          }
        });

        request
          .post("/api/donations")
          .send({
            projectId: "project-ws",
            donorAddress,
            amountXLM: "25",
            transactionHash,
          })
          .end((err) => {
            if (err) {
              clearTimeout(deadline);
              socket.disconnect();
              done(err);
            }
          });
      });

      socket.on("connect_error", (err) => {
        clearTimeout(deadline);
        done(err);
      });
    },
    2000,
  );

  test(
    "does not emit donation_event when the project is not found",
    (done) => {
      const donorAddress = makePublicKey("X");
      const transactionHash = makeTxHash("8");

      createMockClient(
        queryResult([]),  // SELECT project → empty (not found)
      );

      const socket = ioc(baseUrl, {
        transports: ["websocket"],
        forceNew: true,
      });

      let eventReceived = false;

      socket.on("connect", () => {
        socket.on("donation_event", () => {
          eventReceived = true;
        });

        request
          .post("/api/donations")
          .send({
            projectId: "nonexistent-project",
            donorAddress,
            amountXLM: "10",
            transactionHash,
          })
          .end((err, res) => {
            socket.disconnect();
            if (err) return done(err);
            try {
              expect(res.status).toBe(404);
              expect(eventReceived).toBe(false);
              done();
            } catch (assertionError) {
              done(assertionError);
            }
          });
      });

      socket.on("connect_error", (err) => done(err));
    },
    2000,
  );

  test(
    "includes correct amountXLM in the donation_event payload",
    (done) => {
      const donorAddress = makePublicKey("Y");
      const transactionHash = makeTxHash("9");
      const donationRow = {
        id: "socket-donation-2",
        project_id: "project-ws-2",
        donor_address: donorAddress,
        amount_xlm: "100",
        amount: "100",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      };

      createMockClient(
        queryResult([{ id: "project-ws-2" }]),
        queryResult([]),
        queryResult(),
        queryResult([donationRow]),
        queryResult([]),
        queryResult(),
        queryResult([]),
        queryResult([{ count: "1" }]),
        queryResult(),
      );

      const socket = ioc(baseUrl, {
        transports: ["websocket"],
        forceNew: true,
      });

      const deadline = setTimeout(() => {
        socket.disconnect();
        done(new Error("donation_event was not received within 500 ms"));
      }, 500);

      socket.on("connect", () => {
        socket.on("donation_event", (data) => {
          clearTimeout(deadline);
          socket.disconnect();
          try {
            expect(data.amountXLM).toBe("100");
            done();
          } catch (assertionError) {
            done(assertionError);
          }
        });

        request
          .post("/api/donations")
          .send({
            projectId: "project-ws-2",
            donorAddress,
            amountXLM: "100",
            transactionHash,
          })
          .end((err) => {
            if (err) {
              clearTimeout(deadline);
              socket.disconnect();
              done(err);
            }
          });
      });

      socket.on("connect_error", (err) => {
        clearTimeout(deadline);
        done(err);
      });
    },
    2000,
  );
});
