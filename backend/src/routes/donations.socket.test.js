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
const { registerSocketHandlers } = require("../services/socketHandler");

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
    registerSocketHandlers(ioServer);
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
        queryResult([{ total: "0" }]),            // prevTotalResult
        queryResult([donationRow]),               // INSERT donation
        queryResult([]),                          // SELECT donation_matches (empty)
        queryResult(),                            // UPDATE projects
        queryResult(),                            // COMMIT
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
        socket.emit("join_project", "project-ws", () => {
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
        socket.emit("join_project", "nonexistent-project", () => {
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
        queryResult([{ total: "0" }]),
        queryResult([donationRow]),
        queryResult([]),
        queryResult(),
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
        socket.emit("join_project", "project-ws-2", () => {
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
      });

      socket.on("connect_error", (err) => {
        clearTimeout(deadline);
        done(err);
      });
    },
    2000,
  );
});

describe("POST /api/donations → broadcast hardening & room segmentation", () => {
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
    registerSocketHandlers(ioServer);
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

  // Resolves once the socket is connected and joined to room so POSTs never race the handshake.
  function connectClient(room = "all-donations") {
    return new Promise((resolve, reject) => {
      const socket = ioc(baseUrl, { transports: ["websocket"], forceNew: true });
      socket.once("connect", () => {
        if (room === "all-donations") {
          socket.emit("join_global_feed", () => resolve(socket));
        } else if (room.startsWith("project:")) {
          socket.emit("join_project", room.replace("project:", ""), () => resolve(socket));
        } else {
          socket.emit("join_project", room, () => resolve(socket));
        }
      });
      socket.once("connect_error", reject);
    });
  }

  function successfulXlmDonation(donationRow) {
    // Mirrors the query order of recordDonation for a new donor, no active matches.
    createMockClient(
      queryResult([{ id: donationRow.project_id }]), // SELECT project
      queryResult([]),                                // dedup check (none)
      queryResult(),                                  // BEGIN
      queryResult([{ total: "0" }]),                  // prevTotalResult
      queryResult([donationRow]),                     // INSERT donation
      queryResult([]),                                // SELECT donation_matches (none)
      queryResult(),                                  // UPDATE projects
      queryResult(),                                  // COMMIT
    );
  }

  test(
    "joins and leaves project and global rooms correctly",
    (done) => {
      const socket = ioc(baseUrl, { transports: ["websocket"], forceNew: true });
      socket.on("connect", () => {
        socket.emit("join_project", "test-proj", () => {
          socket.emit("join_global_feed", () => {
            const serverSocket = ioServer.sockets.sockets.get(socket.id);
            expect(serverSocket.rooms.has("project:test-proj")).toBe(true);
            expect(serverSocket.rooms.has("all-donations")).toBe(true);

            socket.emit("leave_project", "test-proj", () => {
              socket.emit("leave_global_feed", () => {
                expect(serverSocket.rooms.has("project:test-proj")).toBe(false);
                expect(serverSocket.rooms.has("all-donations")).toBe(false);
                socket.disconnect();
                done();
              });
            });
          });
        });
      });
    },
    2000,
  );

  test(
    "fans the donation_event out to connected clients across project and global rooms",
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

      // Client 1 is on dashboard (all-donations)
      // Client 2 is on project page (project:project-fan)
      // Client 3 is subscribed to both
      const client1 = await connectClient("all-donations");
      const client2 = await connectClient("project-fan");
      const client3 = await connectClient("all-donations");
      await new Promise((resolve) => client3.emit("join_project", "project-fan", resolve));

      const clients = [client1, client2, client3];
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
    "emits exactly one donation_event per recorded donation (deduplicated when in both rooms)",
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

      // Client joined to both project room and all-donations
      const socket = await connectClient("all-donations");
      await new Promise((resolve) => socket.emit("join_project", "project-once", resolve));

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
    "does not broadcast project-specific donation_event to clients in a different project room",
    async () => {
      const donorAddress = makePublicKey("Z");
      const transactionHash = makeTxHash("1");
      successfulXlmDonation({
        id: "isolated-1",
        project_id: "project-target",
        donor_address: donorAddress,
        amount_xlm: "30",
        amount: "30",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      });

      const clientTarget = await connectClient("project-target");
      const clientOther = await connectClient("project-other");

      try {
        let otherReceived = false;
        clientOther.on("donation_event", () => {
          otherReceived = true;
        });

        const targetReceivedPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("target client did not receive event")), 500);
          clientTarget.on("donation_event", (data) => {
            clearTimeout(timer);
            resolve(data);
          });
        });

        await request
          .post("/api/donations")
          .send({
            projectId: "project-target",
            donorAddress,
            amountXLM: "30",
            transactionHash,
          })
          .expect(201);

        const data = await targetReceivedPromise;
        expect(data.projectId).toBe("project-target");

        // Wait to verify the client in project-other didn't receive it
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(otherReceived).toBe(false);
      } finally {
        clientTarget.disconnect();
        clientOther.disconnect();
      }
    },
    3000,
  );

  test(
    "stops receiving events after leaving a room",
    async () => {
      const donorAddress = makePublicKey("K");
      const transactionHash = makeTxHash("2");
      successfulXlmDonation({
        id: "leave-1",
        project_id: "project-leave",
        donor_address: donorAddress,
        amount_xlm: "20",
        amount: "20",
        currency: "XLM",
        message: null,
        transaction_hash: transactionHash,
        created_at: new Date().toISOString(),
      });

      const socket = await connectClient("project-leave");
      try {
        await new Promise((resolve) => socket.emit("leave_project", "project-leave", resolve));

        let received = false;
        socket.on("donation_event", () => {
          received = true;
        });

        await request
          .post("/api/donations")
          .send({
            projectId: "project-leave",
            donorAddress,
            amountXLM: "20",
            transactionHash,
          })
          .expect(201);

        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(received).toBe(false);
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
      createMockClient(queryResult([{ id: "project-amt" }])); // amount check fails before any DB query

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
        queryResult([{ total: "0" }]),                     // prevTotalResult
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

      const socket = await connectClient("project-match");
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
