/**
 * components/__tests__/DonationFeed.test.tsx
 *
 * Regression tests for #1071 — the live feed must notice a dropped SSE
 * stream, show a "Reconnecting…" banner, retry with backoff, pull
 * anything it missed over REST, and resume cleanly.
 *
 * Horizon's EventSource has no "reconnected" event, so the tests drive
 * the `streamProjectPayments` contract directly: the fourth argument is
 * the error hook and the second is the payment handler.
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { fetchProjectDonations } from "@/lib/api";
import { streamProjectPayments } from "@/lib/stellar";
import type { Donation } from "@/utils/types";

jest.mock("@/lib/api", () => ({
  fetchProjectDonations: jest.fn(),
}));

jest.mock("@/lib/stellar", () => ({
  explorerUrl: (hash: string) => `https://lab.stellar.org/tx/${hash}`,
  streamProjectPayments: jest.fn(),
}));

import DonationFeed from "@/components/DonationFeed";

const WALLET = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST";

type StreamHandler = (payment: {
  id: string;
  from: string;
  amount: string;
  asset: string;
  createdAt: string;
  transactionHash: string;
}) => void;
type StreamError = (error: unknown) => void;

function donation(id: string, overrides: Partial<Donation> = {}): Donation {
  return {
    id,
    projectId: "proj-1",
    donorAddress: "GVDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amountXLM: "12.5",
    amount: "12.5",
    currency: "XLM",
    transactionHash: `tx-${id}`,
    createdAt: "2025-01-05T10:00:00.000Z",
    ...overrides,
  };
}

/** Every (onPayment, onError) pair handed to the stream, newest last. */
let streams: Array<{ onPayment: StreamHandler; onError: StreamError; cursor?: string; close: jest.Mock }> = [];

function lastStream() {
  return streams[streams.length - 1];
}

beforeEach(() => {
  jest.useFakeTimers();
  streams = [];
  jest.clearAllMocks();

  (fetchProjectDonations as jest.Mock).mockResolvedValue({
    donations: [donation("pay-2"), donation("pay-1")],
    nextCursor: null,
  });

  (streamProjectPayments as jest.Mock).mockImplementation(
    (_wallet: string, onPayment: StreamHandler, cursor?: string, onError?: StreamError) => {
      const close = jest.fn();
      streams.push({ onPayment, onError: onError!, cursor, close });
      return close;
    },
  );
});

afterEach(() => {
  jest.useRealTimers();
});

async function renderFeed() {
  render(<DonationFeed projectId="proj-1" walletAddress={WALLET} />);
  // The stream only arms after the initial REST load settles.
  await waitFor(() => expect(streams).toHaveLength(1));
}

describe("DonationFeed live stream", () => {
  it("arms the stream from the newest known donation id", async () => {
    await renderFeed();

    expect(streamProjectPayments).toHaveBeenCalledWith(
      WALLET,
      expect.any(Function),
      "pay-2",
      expect.any(Function),
    );
    expect(screen.getByText(/Live — new donations appear automatically/)).toBeInTheDocument();
  });

  it("prepends payments that arrive on an open stream", async () => {
    await renderFeed();
    expect(screen.getAllByText("View tx ↗")).toHaveLength(2);

    act(() => {
      lastStream().onPayment({
        id: "pay-9",
        from: "GVNEWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        amount: "30",
        asset: "XLM",
        createdAt: "2025-01-06T10:00:00.000Z",
        transactionHash: "tx-pay-9",
      });
    });

    expect(screen.getByText("30 XLM")).toBeInTheDocument();
    expect(screen.getAllByText("View tx ↗")).toHaveLength(3);
  });

  it("shows a reconnecting banner and closes the dead stream on error", async () => {
    await renderFeed();

    act(() => {
      lastStream().onError(new Error("network down"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(/Connection lost — reconnecting/i);
    expect(lastStream().close).toHaveBeenCalled();
  });

  it("re-subscribes after the first backoff step and catches up over REST", async () => {
    await renderFeed();
    (fetchProjectDonations as jest.Mock).mockClear();

    act(() => {
      lastStream().onError(new Error("network down"));
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(streams).toHaveLength(2);
    await waitFor(() =>
      expect(fetchProjectDonations).toHaveBeenCalledWith("proj-1", 10),
    );
  });

  it("backoff grows on repeated failures", async () => {
    await renderFeed();

    act(() => {
      lastStream().onError(new Error("network down"));
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(streams).toHaveLength(2);

    // Second drop must wait 2s, not 1s.
    act(() => {
      lastStream().onError(new Error("network down"));
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(streams).toHaveLength(2);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(streams).toHaveLength(3);
  });

  it("resumes the feed and clears the banner once an event arrives", async () => {
    (fetchProjectDonations as jest.Mock).mockResolvedValue({
      donations: [donation("pay-2"), donation("pay-1")],
      nextCursor: null,
    });
    await renderFeed();

    act(() => {
      lastStream().onError(new Error("network down"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    act(() => {
      lastStream().onPayment({
        id: "pay-10",
        from: "GVNEWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        amount: "42",
        asset: "XLM",
        createdAt: "2025-01-07T10:00:00.000Z",
        transactionHash: "tx-pay-10",
      });
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(/Live — new donations appear automatically/)).toBeInTheDocument();
  });

  it("merges donations that landed while disconnected, exactly once", async () => {
    await renderFeed();
    expect(screen.getAllByText("View tx ↗")).toHaveLength(2);

    // While we were down, two more donations were recorded server-side.
    (fetchProjectDonations as jest.Mock).mockResolvedValue({
      donations: [donation("pay-4"), donation("pay-3"), donation("pay-2"), donation("pay-1")],
      nextCursor: null,
    });

    act(() => {
      lastStream().onError(new Error("network down"));
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() =>
      expect(screen.getAllByText("View tx ↗")).toHaveLength(4),
    );

    // The retry arms immediately (it doesn't wait on REST) and resumes
    // from the last id we had, so the replay + the catch-up page overlap
    // harmlessly instead of leaving a gap.
    expect(lastStream().cursor).toBe("pay-2");

    // Re-delivering an already-listed donation must not duplicate the row.
    act(() => {
      lastStream().onPayment({
        id: "pay-4",
        from: "GVDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        amount: "12.5",
        asset: "XLM",
        createdAt: "2025-01-05T10:00:00.000Z",
        transactionHash: "tx-pay-4",
      });
    });
    expect(screen.getAllByText("View tx ↗")).toHaveLength(4);
  });

  it("stops retrying once unmounted", async () => {
    const { unmount } = render(<DonationFeed projectId="proj-1" walletAddress={WALLET} />);
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => {
      lastStream().onError(new Error("network down"));
    });
    unmount();

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(streams).toHaveLength(1);
    expect(lastStream().close).toHaveBeenCalled();
  });
});
