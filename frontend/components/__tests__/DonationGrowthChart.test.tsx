import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("does not fetch when a data prop is supplied", () => {
    render(<DonationGrowthChart data={[{ week: "2026-W01", totalXLM: 1 }]} />);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
