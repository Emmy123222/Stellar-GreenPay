/**
 * @jest-environment jsdom
 *
 * Tests for the shared chart accessibility helpers introduced for #1314:
 * trend/distribution descriptions that feed the charts' aria-labels, and the
 * visually hidden data table that mirrors each chart's series.
 */
import { render, screen, within } from "@testing-library/react";
import {
  AccessibleChart,
  VisuallyHiddenChartTable,
  describeDistribution,
  describeLineTrend,
  lineChartAriaLabel,
} from "../ChartA11y";

describe("describeLineTrend", () => {
  test("handles an empty series", () => {
    expect(describeLineTrend([], "XLM")).toBe("no data available yet");
  });

  test("describes a single data point", () => {
    expect(describeLineTrend([{ label: "2026-W01", value: 12.5 }], "XLM")).toBe(
      "a single value of 12.5 XLM at 2026-W01",
    );
  });

  test("summarises an increasing series with its high and low", () => {
    const trend = describeLineTrend(
      [
        { label: "A", value: 10 },
        { label: "B", value: 40 },
        { label: "C", value: 25 },
      ],
      "XLM",
    );
    expect(trend).toBe(
      "increased from 10 XLM at A to 25 XLM at C, with a high of 40 XLM at B and a low of 10 XLM at A",
    );
  });

  test("summarises a decreasing series", () => {
    const trend = describeLineTrend(
      [
        { label: "A", value: 50 },
        { label: "B", value: 20 },
      ],
      "XLM",
    );
    expect(trend.startsWith("decreased from 50 XLM at A to 20 XLM at B")).toBe(true);
  });

  test("reports a flat series as flat", () => {
    const trend = describeLineTrend(
      [
        { label: "A", value: 7 },
        { label: "B", value: 7 },
      ],
      "t",
    );
    expect(trend.startsWith("flat at 7 t at A to 7 t at B")).toBe(true);
  });

  test("lineChartAriaLabel prefixes the chart title", () => {
    expect(lineChartAriaLabel("Weekly XLM donations over time", [], "XLM")).toBe(
      "Weekly XLM donations over time: no data available yet",
    );
  });
});

describe("describeDistribution", () => {
  test("lists shares sorted largest first with percentages", () => {
    expect(
      describeDistribution([
        { label: "Solar Energy", share: 33.333 },
        { label: "Reforestation", share: 66.667 },
      ]),
    ).toBe("Reforestation 66.67%, Solar Energy 33.33%");
  });

  test("handles an empty chart", () => {
    expect(describeDistribution([])).toBe("no data available yet");
  });
});

describe("VisuallyHiddenChartTable", () => {
  test("renders an accessible table with a caption and row headers", () => {
    render(
      <VisuallyHiddenChartTable
        caption="Weekly XLM donations"
        headers={["Week", "XLM donated"]}
        rows={[["2026-W01", "12.5"]]}
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("Weekly XLM donations")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Week" })).toBeInTheDocument();
    const rowHeader = within(table).getByRole("rowheader", { name: "2026-W01" });
    expect(rowHeader).toHaveAttribute("scope", "row");
    expect(within(table).getByText("12.5")).toBeInTheDocument();
  });
});

describe("AccessibleChart", () => {
  test("exposes role=img with the label, and keeps the table as a sibling", () => {
    render(
      <AccessibleChart
        label="Donations by category: Reforestation 66.67%"
        table={{
          caption: "Donations by category",
          headers: ["Category", "Donations"],
          rows: [["Reforestation", "10"]],
        }}
      >
        <p>the visual chart</p>
      </AccessibleChart>,
    );

    const region = screen.getByRole("img");
    expect(region).toHaveAttribute("aria-label", "Donations by category: Reforestation 66.67%");

    // role="img" makes descendants presentational, so the table must not live
    // inside the wrapper or screen readers would never announce it.
    const table = screen.getByRole("table");
    expect(region.contains(table)).toBe(false);
    expect(within(table).getByText("Reforestation")).toBeInTheDocument();
  });
});
