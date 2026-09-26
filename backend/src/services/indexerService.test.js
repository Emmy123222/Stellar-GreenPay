const mockStream = jest.fn();

jest.mock("./stellar", () => ({
  server: {
    operations: () => ({ cursor: () => ({ stream: mockStream }) }),
  },
}));
jest.mock("../db/pool", () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock("./store", () => ({ computeBadges: jest.fn(() => []) }));
jest.mock("./webhook", () => ({ checkAndDeliverMilestones: jest.fn() }));
jest.mock("./donationEvents", () => ({ emit: jest.fn() }));
jest.mock("../logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { startIndexer, stopIndexer } = require("./indexerService");

describe("indexer Horizon stream recovery", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockStream.mockReset();
    mockStream.mockReturnValue(jest.fn());
  });

  afterEach(() => {
    stopIndexer();
    jest.useRealTimers();
  });

  it("backs off after an authorization error instead of reconnecting immediately", async () => {
    await startIndexer({ emit: jest.fn() });
    const handlers = mockStream.mock.calls[0][0];

    handlers.onerror({ status: 401, message: "unauthorized" });
    expect(mockStream).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(900);
    expect(mockStream).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(500);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });
});
