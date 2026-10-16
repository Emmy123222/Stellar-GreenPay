import { render, screen, act } from "@testing-library/react";
import DonationTicker, { TickerItem } from "../DonationTicker";
import { setFormattingLocale } from "@/lib/formatLocale";
import { io } from "socket.io-client";

// Mock stellar Horizon server so it doesn't attempt network calls in tests
jest.mock("@/lib/stellar", () => ({
  server: {
    payments: () => ({
      limit: () => ({
        order: () => ({
          call: () => Promise.resolve({ records: [] }),
        }),
      }),
      cursor: () => ({
        stream: () => () => {},
      }),
    }),
  },
}));

type SocketEventHandler = (data: any) => void;
let registeredEventHandlers: Record<string, SocketEventHandler[]> = {};
let mockSocketInstance: any = null;

jest.mock("socket.io-client", () => ({
  io: jest.fn(() => mockSocketInstance),
}));

describe("DonationTicker Component", () => {
  const mockItems: TickerItem[] = [
    {
      id: "pay-1",
      from: "GDONOR1234567890TESTNETADDRESSEXAMPLE",
      amount: "100.5",
      asset: "XLM",
      time: "2m ago",
    },
    {
      id: "pay-2",
      from: "GBENEFICIARY9876543210TESTNETADDRESS",
      amount: "25",
      asset: "USDC",
      time: "5m ago",
    },
  ];

  beforeEach(() => {
    setFormattingLocale("en-US");
    registeredEventHandlers = {};
    mockSocketInstance = {
      on: jest.fn((event: string, handler: SocketEventHandler) => {
        if (!registeredEventHandlers[event]) registeredEventHandlers[event] = [];
        registeredEventHandlers[event].push(handler);
        return mockSocketInstance;
      }),
      off: jest.fn((event: string, handler: SocketEventHandler) => {
        if (registeredEventHandlers[event]) {
          registeredEventHandlers[event] = registeredEventHandlers[event].filter((h) => h !== handler);
        }
        return mockSocketInstance;
      }),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    (io as jest.Mock).mockClear();
  });

  function triggerSocketEvent(event: string, payload: any) {
    act(() => {
      (registeredEventHandlers[event] || []).forEach((handler) => handler(payload));
    });
  }

  describe("Accessibility", () => {
    it("is marked with aria-live='off' to exclude marquee stream from spamming screen readers", () => {
      render(<DonationTicker initialItems={mockItems} />);

      const tickerRegion = screen.getByRole("region", {
        name: /live network activity/i,
      });
      expect(tickerRegion).toBeInTheDocument();
      expect(tickerRegion).toHaveAttribute("aria-live", "off");
    });

    it("includes a visually-hidden description referenced via aria-describedby", () => {
      render(<DonationTicker initialItems={mockItems} />);

      const tickerRegion = screen.getByRole("region", {
        name: /live network activity/i,
      });
      const describedById = tickerRegion.getAttribute("aria-describedby");
      expect(describedById).toBe("donation-ticker-description");

      const descriptionEl = document.getElementById(describedById!);
      expect(descriptionEl).toBeInTheDocument();
      expect(descriptionEl).toHaveClass("sr-only");
      expect(descriptionEl).toHaveTextContent(
        /announcements are disabled to prevent spamming screen readers/i,
      );
    });

    it("renders donation items when present", () => {
      render(<DonationTicker initialItems={mockItems} />);

      expect(screen.getByText(/100\.50 XLM/i)).toBeInTheDocument();
      expect(screen.getByText(/25\.00 USDC/i)).toBeInTheDocument();
    });

    it("renders null when there are no ticker items", () => {
      const { container } = render(<DonationTicker initialItems={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Socket.io real-time streaming", () => {
    it("initializes socket connection and registers listeners", () => {
      render(<DonationTicker initialItems={mockItems} />);
      expect(io).toHaveBeenCalled();
      expect(mockSocketInstance.on).toHaveBeenCalledWith("connect", expect.any(Function));
      expect(mockSocketInstance.on).toHaveBeenCalledWith("donation_event", expect.any(Function));
      expect(mockSocketInstance.on).toHaveBeenCalledWith("newDonation", expect.any(Function));
      expect(mockSocketInstance.on).toHaveBeenCalledWith("donation", expect.any(Function));

      // Simulate connect event triggers join_global_feed
      triggerSocketEvent("connect", {});
      expect(mockSocketInstance.emit).toHaveBeenCalledWith("join_global_feed");
    });

    it("renders incoming donation events driven by socket mock", () => {
      render(<DonationTicker initialItems={[]} />);
      expect(screen.queryByRole("region")).toBeNull();

      // Trigger incoming donation event
      triggerSocketEvent("donation_event", {
        id: "socket-don-1",
        donorAddress: "GDONOR9999999999TESTNETADDRESS",
        amountXLM: "500",
        asset: "XLM",
        timestamp: "2026-10-15T20:00:00Z",
      });

      expect(screen.getByRole("region")).toBeInTheDocument();
      expect(screen.getByText(/500\.00 XLM/i)).toBeInTheDocument();
      expect(screen.getByText(/GDONOR\.\.\.DDRESS/)).toBeInTheDocument();
    });

    it("caps the visible list length at 10 items", () => {
      render(<DonationTicker initialItems={[]} />);

      // Emit 15 distinct donation events
      for (let i = 1; i <= 15; i++) {
        triggerSocketEvent("donation_event", {
          id: `item-${i}`,
          donorAddress: `GDONOR${i.toString().padStart(10, "0")}TESTNETADDRESS`,
          amountXLM: `${i * 10}`,
          asset: "XLM",
          timestamp: "2026-10-15T20:00:00Z",
        });
      }

      // Items 6 through 15 should be present (10 items total)
      expect(screen.getByText("+150.00 XLM")).toBeInTheDocument(); // item 15 (newest)
      expect(screen.getByText("+60.00 XLM")).toBeInTheDocument();  // item 6 (10th oldest)

      // Items 1 through 5 should have been capped and dropped
      expect(screen.queryByText("+50.00 XLM")).toBeNull();
      expect(screen.queryByText("+10.00 XLM")).toBeNull();
    });

    it("cleans up socket listeners and leaves room on unmount without leaking", () => {
      const { unmount } = render(<DonationTicker initialItems={mockItems} />);

      unmount();

      expect(mockSocketInstance.emit).toHaveBeenCalledWith("leave_global_feed");
      expect(mockSocketInstance.off).toHaveBeenCalledWith("donation_event", expect.any(Function));
      expect(mockSocketInstance.off).toHaveBeenCalledWith("newDonation", expect.any(Function));
      expect(mockSocketInstance.off).toHaveBeenCalledWith("donation", expect.any(Function));
      expect(mockSocketInstance.disconnect).toHaveBeenCalled();
    });
  });

  describe("Locale-aware amount formatting", () => {
    it("formats amounts via shared formatting utilities respecting German locale", () => {
      setFormattingLocale("de-DE");
      render(<DonationTicker initialItems={mockItems} />);

      // In German locale (de-DE), decimal point is a comma: "100,50 XLM"
      expect(screen.getByText(/100,50 XLM/)).toBeInTheDocument();
      expect(screen.getByText(/25,00 USDC/)).toBeInTheDocument();
    });

    it("formats newly streamed socket donations respecting the active locale", () => {
      setFormattingLocale("de-DE");
      render(<DonationTicker initialItems={[]} />);

      triggerSocketEvent("newDonation", {
        id: "de-pay-1",
        donorAddress: "GGERMANDONOR1234567890TEST",
        amountXLM: "1234.5",
        asset: "XLM",
      });

      // 1.234,50 XLM
      expect(screen.getByText(/1\.234,50 XLM/)).toBeInTheDocument();
    });
  });
});
