import { fetchStatusSnapshot } from "@/lib/status";

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("fetchStatusSnapshot", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  it("reads health data even when the API reports degraded status with HTTP 503", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(503, {
        status: "degraded",
        timestamp: "2026-10-16T00:00:00.000Z",
        checks: { db: "ok", redis: "unreachable" },
      }))
      .mockResolvedValueOnce(response(200, {
        status: "ok",
        timestamp: "2026-10-16T00:00:00.000Z",
        lagLedgers: 2,
      }));

    const status = await fetchStatusSnapshot();

    expect(status.api.state).toBe("degraded");
    expect(status.database.state).toBe("healthy");
    expect(status.redis.state).toBe("unavailable");
    expect(status.indexer.lagLedgers).toBe(2);
  });

  it("returns unavailable checks instead of throwing when the API is down", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network failure"));

    const status = await fetchStatusSnapshot();

    expect(status.api.state).toBe("unavailable");
    expect(status.database.state).toBe("unavailable");
    expect(status.redis.state).toBe("unavailable");
    expect(status.indexer.state).toBe("unavailable");
    expect(status.api.detail).not.toContain("network failure");
  });

  it("does not accept an invalid or negative indexer lag as a measurement", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(200, {
        status: "ok",
        timestamp: "2026-10-16T00:00:00.000Z",
        checks: { db: "ok", redis: "ok" },
      }))
      .mockResolvedValueOnce(response(200, {
        status: "ok",
        timestamp: "2026-10-16T00:00:00.000Z",
        lagLedgers: -3,
      }));

    const status = await fetchStatusSnapshot();

    expect(status.indexer.lagLedgers).toBeNull();
    expect(status.indexer.detail).toBe("Indexer lag could not be determined.");
  });
});
