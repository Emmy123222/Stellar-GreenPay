/**
 * @jest-environment jsdom
 *
 * Frontend tests for pages/leaderboard/history.tsx — specifically the 6-month
 * top-donor trend chart, which must expose a text alternative for screen
 * readers (issue #1314: role="img" + trend aria-label + visually hidden data
 * table).
 *
 * The page reads from `GET /api/leaderboard/history` through the global
 * `fetch`, so that is stubbed directly. recharts primitives are mocked the
 * same way as in the DonationGrowthChart tests so jsdom needs no layout.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

import LeaderboardHistoryPage from "@/pages/leaderboard/history";

const DONOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const HISTORY = {
  success: true,
  data: [
    {
      month: "2026-07",
      entries: [
        { rank: 1, donorAddress: DONOR, displayName: "Ada", totalXLMThatMonth: "100", badge: "tree" },
        { rank: 2, donorAddress: DONOR, displayName: null, totalXLMThatMonth: "40", badge: null },
      ],
    },
    {
      month: "2026-08",
      entries: [
        { rank: 1, donorAddress: DONOR, displayName: "Ada", totalXLMThatMonth: "250", badge: "forest" },
      ],
    },
    {
      month: "2026-09",
      entries: [
        { rank: 1, donorAddress: DONOR, displayName: "Ada", totalXLMThatMonth: "180", badge: "earth" },
      ],
    },
  ],
};

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ json: async () => HISTORY });
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe("leaderboard history trend chart accessibility", () => {
  test("labels the chart with a trend summary and provides a hidden data table", async () => {
    render(<LeaderboardHistoryPage />);

    const region = await screen.findByRole("img");
    expect(region).toHaveAttribute(
      "aria-label",
      "Ada's XLM donations over the past 6 months: increased from 100 XLM at July 2026 to 180 XLM at September 2026, with a high of 250 XLM at August 2026 and a low of 100 XLM at July 2026",
    );
    expect(region.contains(screen.getByTestId("line-chart"))).toBe(true);

    const table = screen.getByRole("table");
    expect(region.contains(table)).toBe(false);
    expect(within(table).getByText("Ada's monthly XLM donations over the past 6 months")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Month" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "August 2026" })).toBeInTheDocument();
    expect(within(table).getByText("250")).toBeInTheDocument();
  });

  test("does not render a chart region when there is no history", async () => {
    mockFetch.mockResolvedValue({ json: async () => ({ success: true, data: [] }) });

    render(<LeaderboardHistoryPage />);

    await screen.findByText(/No monthly snapshots yet/);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
