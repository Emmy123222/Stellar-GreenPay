import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import DonationGrowthChart from "../DonationGrowthChart";
import { fetchDonationGrowth } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  fetchDonationGrowth: jest.fn(),
}));

// recharts needs real layout dimensions; stub the primitives so the chart
// renders its data in jsdom.
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line-${dataKey}`} />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

const mockedFetch = fetchDonationGrowth as jest.MockedFunction<typeof fetchDonationGrowth>;

describe("DonationGrowthChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows a loading skeleton, then renders data from the mocked API response", async () => {
    mockedFetch.mockResolvedValue([
      { week: "2026-W01", totalXLM: 12.5 },
      { week: "2026-W02", totalXLM: 30 },
    ]);

    render(<DonationGrowthChart projectId="proj-1" />);

    expect(screen.getByRole("status")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    expect(mockedFetch).toHaveBeenCalledWith("proj-1");
    expect(screen.getByTestId("line-totalXLM")).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));

    render(<DonationGrowthChart projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("network down")).toBeInTheDocument();
  });


  it("labels the chart region with a trend summary and mirrors the series in a hidden table (issue #1314)", async () => {
    mockedFetch.mockResolvedValue([
      { week: "2026-W01", totalXLM: 12.5 },
      { week: "2026-W02", totalXLM: 30 },
    ]);

    render(<DonationGrowthChart projectId="proj-1" />);

    const region = await screen.findByRole("img");
    expect(region).toHaveAttribute(
      "aria-label",
      "Weekly XLM donations over time: increased from 12.5 XLM at 2026-W01 to 30 XLM at 2026-W02, with a high of 30 XLM at 2026-W02 and a low of 12.5 XLM at 2026-W01",
    );

    const table = screen.getByRole("table");
    expect(region.contains(table)).toBe(false);
    expect(within(table).getByText("2026-W01")).toBeInTheDocument();
    expect(within(table).getByText("30")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "XLM donated" })).toBeInTheDocument();
  });

  it("does not fetch when a data prop is supplied", () => {
    render(<DonationGrowthChart data={[{ week: "2026-W01", totalXLM: 1 }]} />);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
