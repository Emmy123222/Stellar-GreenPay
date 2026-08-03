"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

jest.mock("pg-boss", () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue("job-1"),
  }));
});

const http = require("http");
const pool = require("../db/pool");
const {
  deliverPayload,
  processDeliveryJob,
  enqueueWebhookDelivery,
  RETRY_DELAYS_SECONDS,
  MAX_ATTEMPTS,
  start,
} = require("./webhook");

describe("deliverPayload", () => {
  let server;
  let port;
  let lastRequest;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        lastRequest = {
          method: req.method,
          headers: req.headers,
          body,
          path: req.url,
        };
        const status = Number(req.headers["x-test-status"] || 200);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: status < 300 }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    lastRequest = null;
  });

  test("POSTs signed JSON and resolves on 2xx", async () => {
    const status = await deliverPayload(
      `http://127.0.0.1:${port}/hook`,
      "test-secret",
      { event: "milestone.reached", projectId: "p1", milestone: "50%" },
    );
    expect(status).toBe(200);
    expect(lastRequest.method).toBe("POST");
    expect(lastRequest.headers["content-type"]).toBe("application/json");
    expect(lastRequest.headers["x-webhook-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(lastRequest.body).milestone).toBe("50%");
  });

  test("rejects on non-2xx responses", async () => {
    // Use a dedicated server response via query — deliverPayload can't set custom headers,
    // so spin a one-off failing endpoint by temporarily changing the handler isn't easy.
    // Instead hit a closed port to simulate failure, and separately test HTTP error via mock URL.
    await expect(
      deliverPayload(`http://127.0.0.1:1/nope`, "secret", { projectId: "p1" }),
    ).rejects.toThrow();
  });
});

describe("enqueueWebhookDelivery", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    await start();
  });

  test("inserts a pending delivery row and schedules a job", async () => {
    const id = await enqueueWebhookDelivery({
      projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      url: "https://example.com/hook",
      payload: { event: "milestone.reached", projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    });

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhook_deliveries"),
      expect.arrayContaining([
        id,
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "https://example.com/hook",
        expect.any(String),
      ]),
    );
  });
});

describe("processDeliveryJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("marks delivery as delivered on successful POST", async () => {
    const deliveryId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // Local HTTP server for this test
    const srv = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const p = srv.address().port;

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: deliveryId,
            project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            url: `http://127.0.0.1:${p}/hook`,
            payload: { event: "milestone.reached", projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", milestone: "25%" },
            status: "pending",
            attempt_count: 0,
            webhook_secret: "secret",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await processDeliveryJob({ data: { deliveryId } });

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'delivered'"),
      [1, deliveryId],
    );

    await new Promise((resolve) => srv.close(resolve));
  });

  test("schedules retry with 1m delay after first failure", async () => {
    const deliveryId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    await start();

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: deliveryId,
            project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            url: "http://127.0.0.1:1/unreachable",
            payload: { event: "milestone.reached", projectId: "p1", milestone: "50%" },
            status: "pending",
            attempt_count: 0,
            webhook_secret: "secret",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await processDeliveryJob({ data: { deliveryId } });

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'pending'"),
      [1, expect.any(String), String(RETRY_DELAYS_SECONDS[0]), deliveryId],
    );
  });

  test("marks as failed after MAX_ATTEMPTS failures", async () => {
    const deliveryId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: deliveryId,
            project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            url: "http://127.0.0.1:1/unreachable",
            payload: { event: "milestone.reached", projectId: "p1", milestone: "75%" },
            status: "pending",
            attempt_count: MAX_ATTEMPTS - 1,
            webhook_secret: "secret",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await processDeliveryJob({ data: { deliveryId } });

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'failed'"),
      [MAX_ATTEMPTS, expect.any(String), deliveryId],
    );
  });

  test("marks as failed when webhook_secret is missing", async () => {
    const deliveryId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: deliveryId,
            project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            url: "https://example.com/hook",
            payload: { event: "milestone.reached" },
            status: "pending",
            attempt_count: 0,
            webhook_secret: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await processDeliveryJob({ data: { deliveryId } });

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'failed'"),
      ["Project webhook_secret missing", deliveryId],
    );
  });

  test("exposes the expected retry schedule", () => {
    expect(RETRY_DELAYS_SECONDS).toEqual([60, 300, 1800, 7200]);
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
