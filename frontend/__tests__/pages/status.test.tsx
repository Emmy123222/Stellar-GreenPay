import { act, fireEvent, render, screen } from "@testing-library/react";
import useSWR from "swr";
import StatusPage from "@/pages/status";
import type { StatusSnapshot } from "@/lib/status";

jest.mock("swr", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("socket.io-client", () => ({
  io: jest.fn(() => ({
    on: jest.fn((event: string, handler: () => void) => {
      mockSocketHandlers[event] = handler;
    }),
    disconnect: mockSocketDisconnect,
  })),
}));

const mockSocketHandlers: Record<string, () => void> = {};
const mockSocketDisconnect = jest.fn();
const mockMutate = jest.fn();
const mockUseSWR = useSWR as jest.Mock;

const timestamp = "2026-10-16T00:00:00.000Z";
const baseSnapshot: StatusSnapshot = {
  api: { state: "healthy", checkedAt: timestamp, detail: "API is responding." },
  database: { state: "healthy", checkedAt: timestamp, detail: "Database is responding." },
  redis: { state: "healthy", checkedAt: timestamp, detail: "Redis is responding." },
  indexer: {
    state: "healthy",
    checkedAt: timestamp,
    lagLedgers: 2,
    detail: "2 ledgers behind.",
  },
};

function configureSWR(data: StatusSnapshot | undefined, isLoading = false) {
  mockUseSWR.mockReturnValue({
    data,
    error: undefined,
    isLoading,
    isValidating: false,
    mutate: mockMutate,
  });
}

describe("StatusPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockSocketHandlers).forEach((key) => delete mockSocketHandlers[key]);
    configureSWR(baseSnapshot);
  });

  it("shows live service tiles and warns when indexer lag reaches the threshold", () => {
    configureSWR({
      ...baseSnapshot,
      indexer: { ...baseSnapshot.indexer, lagLedgers: 5 },
    });

    render(<StatusPage />);

    expect(mockUseSWR).toHaveBeenCalledWith(
      "status-page",
      expect.any(Function),
      expect.objectContaining({ refreshInterval: 30_000 }),
    );
    expect(screen.getByRole("heading", { name: "API" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Database" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Redis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Indexer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "WebSocket" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/degraded or unavailable/i);
    expect(screen.getByText(/Warning at 5 ledgers/)).toBeInTheDocument();
    expect(screen.getAllByText(/Last checked:/)).toHaveLength(5);
  });

  it("renders a degraded banner and API-unavailable details without crashing", () => {
    configureSWR({
      ...baseSnapshot,
      api: { state: "unavailable", checkedAt: timestamp, detail: "API unreachable." },
      database: { state: "unavailable", checkedAt: timestamp, detail: "Status unavailable." },
      redis: { state: "unavailable", checkedAt: timestamp, detail: "Status unavailable." },
      indexer: {
        state: "unavailable",
        checkedAt: timestamp,
        lagLedgers: null,
        detail: "Indexer status unavailable.",
      },
    });

    render(<StatusPage />);

    expect(screen.getByText("Backend health data unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Database and Redis status cannot be confirmed/)).toBeInTheDocument();
  });

  it("allows manual refresh and reports WebSocket connection events", () => {
    render(<StatusPage />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(mockMutate).toHaveBeenCalledTimes(1);

    act(() => mockSocketHandlers.connect());
    expect(screen.getByText("WebSocket connection is open.")).toBeInTheDocument();
  });
});
