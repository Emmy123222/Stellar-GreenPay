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

describe("POST /api/donations → broadcast hardening", () => {
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
      baseUrl = `http://localhost:${httpServer.address().port}`;
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

  // Resolves once the socket is connected so POSTs never race the handshake.
  function connectClient() {
    return new Promise((resolve, reject) => {
      const socket = ioc(baseUrl, { transports: ["websocket"], forceNew: true });
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });
  }

  function successfulXlmDonation(donationRow) {
    // Mirrors the query order of recordDonation for a new donor, no active matches.
    createMockClient(
      queryResult([{ id: donationRow.project_id }]), // SELECT project
      queryResult([]),                                // dedup check (none)
      queryResult(),                                  // BEGIN
      queryResult([donationRow]),                     // INSERT donation
      queryResult([]),                                // SELECT donation_matches (none)
      queryResult(),                                  // UPDATE projects
      queryResult([]),                                // SELECT profile (new donor)
      queryResult([{ count: "1" }]),                  // COUNT(DISTINCT project_id)
      queryResult(),                                  // INSERT profile
      queryResult(),                                  // COMMIT
    );
  }

  test(
    "fans the donation_event out to every connected client",
    async () => {
      const donorAddress = makePublicKey("F");
      const transactionHash = makeTxHash("a");
      successfulXlmDonation({
        id: "fanout-1",
        project_id: "project-fan",
        donor_address: donorAddress,
        amount_xlm: "42",
        amount: "42",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      });

      const clients = await Promise.all([connectClient(), connectClient(), connectClient()]);
      try {
        const received = clients.map(
          (socket) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("client did not receive donation_event")),
                500,
              );
              socket.on("donation_event", (data) => {
                clearTimeout(timer);
                resolve(data);
              });
            }),
        );

        await request
          .post("/api/donations")
          .send({ projectId: "project-fan", donorAddress, amountXLM: "42", transactionHash })
          .expect(201);

        const payloads = await Promise.all(received);
        for (const payload of payloads) {
          expect(payload).toMatchObject({
            projectId: "project-fan",
            donorAddress,
            amountXLM: "42",
            transactionHash,
          });
        }
      } finally {
        clients.forEach((socket) => socket.disconnect());
      }
    },
    3000,
  );

  test(
    "emits exactly one donation_event per recorded donation",
    async () => {
      const donorAddress = makePublicKey("G");
      const transactionHash = makeTxHash("b");
      successfulXlmDonation({
        id: "once-1",
        project_id: "project-once",
        donor_address: donorAddress,
        amount_xlm: "10",
        amount: "10",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      });

      const socket = await connectClient();
      try {
        let count = 0;
        socket.on("donation_event", () => {
          count += 1;
        });

        await request
          .post("/api/donations")
          .send({ projectId: "project-once", donorAddress, amountXLM: "10", transactionHash })
          .expect(201);

        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(count).toBe(1);
      } finally {
        socket.disconnect();
      }
    },
    3000,
  );

  test(
    "does not re-broadcast a duplicate transaction hash (idempotent replay)",
    async () => {
      const donorAddress = makePublicKey("H");
      const transactionHash = makeTxHash("c");
      // Project exists, but the tx hash is already recorded → early return, no INSERT/emit.
      createMockClient(
        queryResult([{ id: "project-dupe" }]),
        queryResult([
          {
            id: "existing-donation",
            project_id: "project-dupe",
            donor_address: donorAddress,
            amount_xlm: "15",
            amount: "15",
            currency: "XLM",
            message: null,
            transaction_hash: transactionHash,
            created_at: new Date().toISOString(),
          },
        ]),
      );

      const socket = await connectClient();
      try {
        let emitted = false;
        socket.on("donation_event", () => {
          emitted = true;
        });

        const res = await request
          .post("/api/donations")
          .send({ projectId: "project-dupe", donorAddress, amountXLM: "15", transactionHash });

        expect(res.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(emitted).toBe(false);
      } finally {
        socket.disconnect();
      }
    },
    3000,
  );

  test.each([
    ["an invalid donor key", { projectId: "p", donorAddress: "not-a-key", amountXLM: "10", transactionHash: makeTxHash("d") }],
    ["an invalid transaction hash", { projectId: "p", donorAddress: makePublicKey("I"), amountXLM: "10", transactionHash: "xyz" }],
  ])(
    "rejects %s with 400 and emits nothing",
    async (_label, body) => {
      createMockClient(); // validation throws before any query runs

      const socket = await connectClient();
      try {
        let emitted = false;
        socket.on("donation_event", () => {
          emitted = true;
        });

        await request.post("/api/donations").send(body).expect(400);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(emitted).toBe(false);
      } finally {
        socket.disconnect();
      }
    },
    3000,
  );

  test(
    "rejects a non-positive amount with 400 and emits nothing",
    async () => {
      createMockClient(queryResult([{ id: "project-amt" }])); // project lookup, then amount check fails

      const socket = await connectClient();
      try {
        let emitted = false;
        socket.on("donation_event", () => {
          emitted = true;
        });

        await request
          .post("/api/donations")
          .send({
            projectId: "project-amt",
            donorAddress: makePublicKey("J"),
            amountXLM: "0",
            transactionHash: makeTxHash("e"),
          })
          .expect(400);

        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(emitted).toBe(false);
      } finally {
        socket.disconnect();
      }
    },
    3000,
  );

  test(
    "emits a single primary event even when matching offers add donation rows",
    async () => {
      const donorAddress = makePublicKey("K");
      const matcherAddress = makePublicKey("M");
      const transactionHash = makeTxHash("f");
      createMockClient(
        queryResult([{ id: "project-match" }]),           // SELECT project
        queryResult([]),                                   // dedup check
        queryResult(),                                     // BEGIN
        queryResult([                                      // INSERT primary donation
          {
            id: "match-primary",
            project_id: "project-match",
            donor_address: donorAddress,
            amount_xlm: "50",
            amount: "50",
            currency: "XLM",
            message: null,
            transaction_hash: transactionHash,
            created_at: new Date().toISOString(),
          },
        ]),
        queryResult([                                      // active matching offer
          { id: "offer-1", matcher_address: matcherAddress, cap_xlm: "100", matched_xlm: "0", multiplier: 2 },
        ]),
        queryResult(),                                     // INSERT match donation
        queryResult(),                                     // UPDATE donation_matches
        queryResult(),                                     // UPDATE projects
        queryResult([]),                                   // SELECT profile
        queryResult([{ count: "1" }]),                     // COUNT(DISTINCT project_id)
        queryResult(),                                     // INSERT profile
        queryResult(),                                     // COMMIT
      );

      const socket = await connectClient();
      try {
        const events = [];
        socket.on("donation_event", (data) => events.push(data));

        await request
          .post("/api/donations")
          .send({ projectId: "project-match", donorAddress, amountXLM: "50", transactionHash })
          .expect(201);

        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ projectId: "project-match", donorAddress });
      } finally {
        socket.disconnect();
      }
    },
    3000,
  );
});
