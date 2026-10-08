/**
 * @jest-environment jsdom
 *
 * Frontend tests for pages/admin/analytics.tsx — specifically the "Donations
 * by Category" pie chart, which must expose a text alternative for screen
 * readers (issue #1314: role="img" + distribution aria-label + visually
 * hidden data table).
 *
 * The donation growth chart is stubbed so this test stays focused on the pie
 * chart; recharts primitives are mocked so jsdom needs no layout.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";

const mockFetchCategoryStats = jest.fn();
jest.mock("@/lib/api", () => ({
  fetchCategoryStats: (...args: unknown[]) => mockFetchCategoryStats(...args),
  fetchDonationGrowth: jest.fn().mockResolvedValue([]),
}));

// utils/format imports `dayjs`, which the repo does not declare as a
// dependency (pre-existing issue, see the baseline failing suites);
// stub the one function this page uses.
jest.mock("@/utils/format", () => ({
  formatXLM: (amount: string | number) => `${amount} XLM`,
}));

jest.mock("@/components/DonationGrowthChart", () => ({
  __esModule: true,
  default: () => <div data-testid="growth-chart-stub" />,
}));

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import AdminAnalytics from "@/pages/admin/analytics";

const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

beforeEach(() => {
  mockFetchCategoryStats.mockReset();
  mockFetchCategoryStats.mockResolvedValue([
    { category: "Reforestation", count: 4, total_xlm: "150", total_donations: 10 },
    { category: "Solar Energy", count: 2, total_xlm: "50", total_donations: 5 },
  ]);
});

describe("admin analytics pie chart accessibility", () => {
  test("labels the chart with its distribution and mirrors it in a hidden table", async () => {
    render(<AdminAnalytics publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    const region = await screen.findByRole("img");
    expect(region).toHaveAttribute(
      "aria-label",
      "Donations by category: Reforestation 66.67%, Solar Energy 33.33%",
    );
    expect(region.contains(screen.getByTestId("pie-chart"))).toBe(true);

    const table = screen.getByRole("table");
    expect(region.contains(table)).toBe(false);
    expect(within(table).getByText("Donations by category, the data shown in the pie chart")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "XLM donated" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Solar Energy" })).toBeInTheDocument();
    expect(within(table).getByText("150 XLM")).toBeInTheDocument();
  });

  test("renders no chart region when there are no categories", async () => {
    mockFetchCategoryStats.mockResolvedValue([]);

    render(<AdminAnalytics publicKey={PUBLIC_KEY} onConnect={jest.fn()} />);

    await waitFor(() => expect(screen.queryByText("Loading data...")).toBeNull());
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
