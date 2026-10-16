import { render, screen } from "@testing-library/react";
import DonationTicker, { TickerItem } from "../DonationTicker";

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

describe("DonationTicker Accessibility", () => {
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
